import { describe, it, expect, vi, afterEach } from "vitest";
import { proxyReadsSession, resolveLoginRedirect, resolveProductDomainRoute } from "@/lib/middlewareLogic";

describe("resolveLoginRedirect", () => {
  it("redirects an unauthenticated request to the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", null)).toBe("/login");
  });

  it("does not redirect an Owner session on the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", "owner")).toBe(null);
  });

  it("redirects an Affiliate session away from the Owner dashboard", () => {
    expect(resolveLoginRedirect("/dashboard", "affiliate")).toBe("/login");
  });

  it("redirects an unauthenticated request to the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", null)).toBe("/affiliates/login");
  });

  it("does not redirect an Affiliate session on the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", "affiliate")).toBe(null);
  });

  it("redirects an Owner session away from the Affiliate dashboard", () => {
    expect(resolveLoginRedirect("/affiliates/dashboard", "owner")).toBe("/affiliates/login");
  });

  it("does not redirect requests to public paths", () => {
    expect(resolveLoginRedirect("/login", null)).toBe(null);
    expect(resolveLoginRedirect("/affiliates/login", null)).toBe(null);
    expect(resolveLoginRedirect("/setup", null)).toBe(null);
    expect(resolveLoginRedirect("/", null)).toBe(null);
  });

  it("sends a visitor with no session away from onboarding", () => {
    expect(resolveLoginRedirect("/onboarding", null)).toBe("/login");
    expect(resolveLoginRedirect("/onboarding/instantgradient/terms", "affiliate")).toBe("/login");
    expect(resolveLoginRedirect("/onboarding", "owner")).toBeNull();
  });
});

describe("resolveProductDomainRoute", () => {
  it("answers not found for the Owner's pages", () => {
    for (const path of ["/login", "/dashboard", "/dashboard/products/acme", "/onboarding/acme/stripe", "/setup"]) {
      expect(resolveProductDomainRoute(path), path).toEqual({ notFound: true });
    }
  });

  it("sends the root to the program's entry page", () => {
    expect(resolveProductDomainRoute("/")).toEqual({ redirect: "/affiliates" });
    expect(resolveProductDomainRoute("/", "owner")).toEqual({ redirect: "/affiliates" });
  });

  it("sends a logged in affiliate from the root to their dashboard", () => {
    expect(resolveProductDomainRoute("/", "affiliate")).toEqual({ redirect: "/affiliates/dashboard" });
  });

  it("leaves affiliate pages and look-alike paths alone", () => {
    for (const path of ["/affiliates", "/affiliates/login", "/affiliates/dashboard", "/affiliates/signup/standard", "/loginx", "/dashboards"]) {
      expect(resolveProductDomainRoute(path), path).toBeNull();
    }
  });
});

describe("with an Owner signup path installed", () => {
  afterEach(() => {
    vi.doUnmock("@/extensions/installed-static");
    vi.resetModules();
  });

  async function logicWith(signupPath: string | null) {
    vi.resetModules();
    vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { owners: { signupPath } } }));
    return import("@/lib/middlewareLogic");
  }

  it("answers not found for the signup page on a product's domain", async () => {
    const logic = await logicWith("/signup");
    expect(logic.resolveProductDomainRoute("/signup")).toEqual({ notFound: true });
    expect(logic.resolveProductDomainRoute("/signup/verify")).toEqual({ notFound: true });
    expect(logic.resolveProductDomainRoute("/signups")).toBeNull();
    expect(logic.resolveProductDomainRoute("/login")).toEqual({ notFound: true });
  });

  it("leaves the same path alone when none is installed", async () => {
    const logic = await logicWith(null);
    expect(logic.resolveProductDomainRoute("/signup")).toBeNull();
  });
});

describe("with an Owner password reset path installed", () => {
  afterEach(() => {
    vi.doUnmock("@/extensions/installed-static");
    vi.resetModules();
  });

  async function logicWith(passwordResetPath: string | null) {
    vi.resetModules();
    vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { owners: { passwordResetPath } } }));
    return import("@/lib/middlewareLogic");
  }

  it("answers not found for the reset page and its subpaths on a product's domain", async () => {
    const logic = await logicWith("/reset-password");
    expect(logic.resolveProductDomainRoute("/reset-password")).toEqual({ notFound: true });
    expect(logic.resolveProductDomainRoute("/reset-password/abc123")).toEqual({ notFound: true });
    expect(logic.resolveProductDomainRoute("/reset-passwords")).toBeNull();
    expect(logic.resolveProductDomainRoute("/affiliates/login")).toBeNull();
  });

  it("leaves the same path alone when none is installed", async () => {
    const logic = await logicWith(null);
    expect(logic.resolveProductDomainRoute("/reset-password")).toBeNull();
  });

  it("does not read an empty path as every page", async () => {
    const logic = await logicWith("");
    expect(logic.resolveProductDomainRoute("/affiliates")).toBeNull();
  });
});

describe("proxyReadsSession", () => {
  it("covers the root and the paths that redirect by session, and nothing else", () => {
    for (const path of ["/", "/login", "/setup", "/dashboard/products", "/onboarding/acme", "/affiliates/dashboard/payouts"]) {
      expect(proxyReadsSession(path), path).toBe(true);
    }
    for (const path of ["/affiliates", "/affiliates/login", "/signup", "/dashboards", "/r/abc"]) {
      expect(proxyReadsSession(path), path).toBe(false);
    }
  });
});
