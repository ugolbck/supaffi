// Every hook is read where it says it is. Each test installs a fake and checks
// that its effect reaches the page, so dropping a call site fails here even
// though no build is present in this repo.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";

const session = { user: { id: "owner-1", role: "owner", email: "o@example.com" } };

beforeEach(() => {
  vi.resetModules();
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new Error(`redirect:${url}`);
    },
    notFound: () => {
      throw new Error("notFound");
    },
  }));
  vi.doMock("@/lib/auth", () => ({ auth: async () => session }));
  vi.doUnmock("@/extensions/installed");
  vi.doUnmock("@/extensions/installed-static");
});

function install(installed: object, installedStatic: object = {}) {
  vi.doMock("@/extensions/installed", () => ({ installed }));
  vi.doMock("@/extensions/installed-static", () => ({ installedStatic }));
}

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return "rendered";
}

describe("owners.signupPath", () => {
  beforeEach(() => {
    vi.doMock("@/lib/owner", () => ({ ownerExists: async () => false }));
  });

  it("sends an empty instance to the setup wizard by default", async () => {
    const { default: Home } = await import("@/app/page");
    expect(await outcome(Home)).toBe("redirect:/setup");
  });

  it("sends an empty instance to signup when set", async () => {
    install({}, { owners: { signupPath: "/signup" } });
    const { default: Home } = await import("@/app/page");
    expect(await outcome(Home)).toBe("redirect:/signup");
    const { default: Login } = await import("@/app/login/page");
    expect(await outcome(Login)).toBe("redirect:/signup");
  });

  it("removes the setup wizard when set", async () => {
    install({}, { owners: { signupPath: "/signup" } });
    const { default: Setup } = await import("@/app/setup/page");
    expect(await outcome(Setup)).toBe("notFound");
  });

  it("links the login page to signup when set, and not by default", async () => {
    vi.doMock("@/lib/owner", () => ({ ownerExists: async () => true }));
    vi.doMock("@/app/login/LoginForm", () => ({ LoginForm: () => null }));
    const { default: Login } = await import("@/app/login/page");
    expect(renderToStaticMarkup((await Login()) as ReactElement)).not.toContain("/signup");

    vi.resetModules();
    install({}, { owners: { signupPath: "/signup" } });
    const { default: OpenLogin } = await import("@/app/login/page");
    expect(renderToStaticMarkup((await OpenLogin()) as ReactElement)).toContain('href="/signup"');
  });
});

describe("dashboard.gate", () => {
  it("redirects the dashboard and onboarding before anything else loads", async () => {
    const listMerchantsForOwner = vi.fn();
    vi.doMock("@/lib/merchant", () => ({ listMerchantsForOwner }));
    install({ dashboard: { gate: async (ownerId: string) => ({ redirect: `/elsewhere/${ownerId}` }) } });

    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    expect(await outcome(() => DashboardLayout({ children: null }))).toBe("redirect:/elsewhere/owner-1");
    expect(listMerchantsForOwner).not.toHaveBeenCalled();

    const { default: OnboardingLayout } = await import("@/app/onboarding/layout");
    expect(await outcome(() => OnboardingLayout({ children: null }))).toBe("redirect:/elsewhere/owner-1");
  });

  it("is not asked about an affiliate session", async () => {
    vi.doMock("@/lib/auth", () => ({ auth: async () => ({ user: { id: "a1", role: "affiliate" } }) }));
    const gate = vi.fn(async () => ({}));
    install({ dashboard: { gate } });
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    expect(await outcome(() => DashboardLayout({ children: null }))).toBe("redirect:/login");
    expect(gate).not.toHaveBeenCalled();
  });
});

describe("dashboard.banner and instance.showInfo in the shell", () => {
  beforeEach(() => {
    vi.doMock("@/lib/merchant", () => ({
      listMerchantsForOwner: async () => [{ id: "m1", slug: "acme", name: "Acme", domain: "a.acme.com", onboardingCompletedAt: null }],
    }));
    vi.doMock("@/lib/affiliate", () => ({ countAffiliatesForMerchant: async () => 0 }));
    vi.doMock("@/lib/program", () => ({ listProgramsForMerchant: async () => [] }));
    vi.doMock("@/lib/commission", () => ({ getCommissionTotals: async () => [] }));
    vi.doMock("@/lib/tracking", () => ({ getTrackingStatus: async () => null }));
    vi.doMock("@/lib/analytics", () => ({ countPayouts: async () => 0 }));
    vi.doMock("@/components/ui/sidebar", () => ({
      SidebarProvider: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
      SidebarInset: ({ children }: { children: React.ReactNode }) => <main>{children}</main>,
      SidebarTrigger: () => null,
    }));
    vi.doMock("@/app/dashboard/AppSidebar", () => ({
      AppSidebar: ({ version }: { version: string | null }) => <nav>version:{String(version)}</nav>,
    }));
  });

  it("render no banner and pass the version by default", async () => {
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    const html = renderToStaticMarkup((await DashboardLayout({ children: <p>page</p> })) as ReactElement);
    const { installedVersion } = await import("@/lib/version");
    expect(html).toContain(`version:${installedVersion()}`);
    expect(html).toContain("<main><div");
    expect(html).toContain("<p>page</p>");
  });

  it("render the installed banner above the page and hide the version", async () => {
    install({ dashboard: { banner: async () => <p>Installed banner</p> } }, { instance: { showInfo: false } });
    const { default: DashboardLayout } = await import("@/app/dashboard/layout");
    const html = renderToStaticMarkup((await DashboardLayout({ children: <p>page</p> })) as ReactElement);
    expect(html.indexOf("Installed banner")).toBeGreaterThan(-1);
    expect(html.indexOf("Installed banner")).toBeLessThan(html.indexOf("page"));
    expect(html).toContain("version:null");
  });
});

describe("account.sections and instance.showInfo", () => {
  beforeEach(() => {
    vi.doMock("@/app/dashboard/account/AccountForms", () => ({ EmailForm: () => null, PasswordForm: () => null }));
  });

  it("show the instance panel and nothing extra by default", async () => {
    const { default: Account } = await import("@/app/dashboard/account/page");
    const html = renderToStaticMarkup((await Account()) as ReactElement);
    expect(html).toContain("This instance");

    const { updateCheckEnabled } = await import("@/lib/version");
    expect(updateCheckEnabled()).toBe(process.env.SUPAFFI_UPDATE_CHECK?.trim().toLowerCase() !== "off");
  });

  it("render installed sections and hide the instance panel", async () => {
    install(
      { account: { sections: async () => [<p key="x">Extra section</p>] } },
      { instance: { showInfo: false } }
    );
    const { default: Account } = await import("@/app/dashboard/account/page");
    const html = renderToStaticMarkup((await Account()) as ReactElement);
    expect(html).toContain("Extra section");
    expect(html).not.toContain("This instance");

    const { updateCheckEnabled } = await import("@/lib/version");
    expect(updateCheckEnabled()).toBe(false);
  });
});
