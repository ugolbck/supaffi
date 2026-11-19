// owners.serves on every way in to a product's domain. Each test installs a
// fake that turns the product away and checks that the surface answers as
// documented and reads or writes nothing past the product lookup. The
// database is a stand-in that fails on anything but that lookup.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactElement } from "react";
import { NextRequest } from "next/server";

const HOST = "partners.acme.test";
const MERCHANT = {
  id: "m1",
  ownerId: "owner-1",
  slug: "acme",
  name: "Acme",
  domain: HOST,
  websiteUrl: "https://acme.test",
  paymentProvider: "STRIPE",
  webhookSecretEnc: "whsec_x",
};

const serves = vi.fn(async (_ownerId: string) => false);
const findFirst = vi.fn(async () => MERCHANT);
const touched: string[] = [];
const signIn = vi.fn(async () => {});
const authPostHandler = vi.fn(async () => new Response(null, { status: 302 }));

// Anything past db.merchant.findFirst is a read or write the turned-away
// product should never reach.
function strictDb() {
  return new Proxy(
    {},
    {
      get: (_target, model: string) =>
        new Proxy(
          {},
          {
            get: (_inner, method: string) => {
              if (model === "merchant" && method === "findFirst") return findFirst;
              return async () => {
                touched.push(`${model}.${method}`);
                throw new Error(`db.${model}.${method}`);
              };
            },
          }
        ),
    }
  );
}

beforeEach(() => {
  vi.resetModules();
  serves.mockReset();
  serves.mockImplementation(async () => false);
  findFirst.mockClear();
  signIn.mockClear();
  authPostHandler.mockClear();
  touched.length = 0;
  vi.doMock("@/extensions/installed", () => ({ installed: { owners: { serves } } }));
  vi.doMock("@/lib/db", () => ({ db: strictDb() }));
  vi.doMock("next/headers", () => ({
    headers: async () => new Headers({ host: HOST, "x-forwarded-host": HOST }),
  }));
  vi.doMock("next/navigation", () => ({
    redirect: (url: string) => {
      throw new Error(`redirect:${url}`);
    },
    notFound: () => {
      throw new Error("notFound");
    },
  }));
  vi.doMock("@/lib/auth", () => ({
    auth: async () => ({ user: { id: "affiliate-1", role: "affiliate", email: "a@example.com" } }),
    signIn,
    handlers: { GET: async () => new Response(null), POST: authPostHandler },
  }));
});

async function outcome(run: () => Promise<unknown>): Promise<string> {
  try {
    await run();
  } catch (error) {
    return (error as Error).message;
  }
  return "rendered";
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("owners.serves on the public endpoints", () => {
  it("leaves track.js empty, briefly cached", async () => {
    const { GET } = await import("@/app/track.js/route");
    const response = await GET(new NextRequest(`https://${HOST}/track.js`, { headers: { host: HOST } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(response.headers.get("cache-control")).toBe("public, max-age=300");
    expect(serves).toHaveBeenCalledTimes(1);
    expect(serves).toHaveBeenCalledWith("owner-1");
  });

  it("answers click tracking like an unknown host and records nothing", async () => {
    const { GET } = await import("@/app/api/track/route");
    const response = await GET(new NextRequest(`https://${HOST}/api/track?via=sarah`, { headers: { host: HOST } }));
    expect(response.status).toBe(404);
    expect(touched).toEqual([]);
    expect(serves).toHaveBeenCalledTimes(1);
  });

  it("leaves the payment webhook to verify and record as always", async () => {
    const { POST } = await import("@/app/api/webhooks/[provider]/route");
    const response = await POST(
      new NextRequest(`https://${HOST}/api/webhooks/stripe`, {
        method: "POST",
        headers: { host: HOST, "stripe-signature": "not a signature" },
        body: "{}",
      }),
      { params: Promise.resolve({ provider: "stripe" }) }
    );
    // Refused by the signature check, which a paused product still runs.
    expect(response.status).toBe(400);
    expect(serves).not.toHaveBeenCalled();
  });

  it("leaves the certificate check to answer as always", async () => {
    const { GET } = await import("@/app/api/internal/domain-check/route");
    const response = await GET(
      new NextRequest(`http://app:3000/api/internal/domain-check?domain=${HOST}`, {
        headers: { "x-forwarded-for": "172.18.0.3" },
      })
    );
    expect(response.status).toBe(200);
    expect(serves).not.toHaveBeenCalled();
  });

  it("answers as before when the hook lets the product be served", async () => {
    serves.mockResolvedValue(true);
    const { GET: script } = await import("@/app/track.js/route");
    expect(await (await script(new NextRequest(`https://${HOST}/track.js`, { headers: { host: HOST } }))).text()).not.toBe("");
  });
});

describe("owners.serves on the affiliate portal", () => {
  const getMerchantByDomain = vi.fn(async (_host: string): Promise<typeof MERCHANT | null> => MERCHANT);

  beforeEach(() => {
    getMerchantByDomain.mockClear();
    vi.doMock("@/lib/merchant", () => ({ getMerchantByDomain }));
  });

  const pages: Record<string, () => Promise<unknown>> = {
    entry: async () => (await import("@/app/affiliates/page")).default(),
    login: async () => (await import("@/app/affiliates/login/page")).default(),
    password: async () =>
      (await import("@/app/affiliates/password/page")).default({ searchParams: Promise.resolve({ token: "t" }) }),
    "forgot password": async () => (await import("@/app/affiliates/forgot-password/page")).default(),
    signup: async () =>
      (await import("@/app/affiliates/signup/[program]/page")).default({ params: Promise.resolve({ program: "p" }) }),
    "dashboard layout": async () => (await import("@/app/affiliates/dashboard/layout")).default({ children: null }),
    dashboard: async () => (await import("@/app/affiliates/dashboard/page")).default({ searchParams: Promise.resolve({}) }),
    links: async () => (await import("@/app/affiliates/dashboard/links/page")).default(),
    commissions: async () =>
      (await import("@/app/affiliates/dashboard/commissions/page")).default({ searchParams: Promise.resolve({}) }),
    payouts: async () => (await import("@/app/affiliates/dashboard/payouts/page")).default(),
  };

  const actions: Record<string, () => Promise<unknown>> = {
    login: async () =>
      (await import("@/app/affiliates/login/loginAffiliate")).loginAffiliate(
        { error: "" },
        form({ email: "a@example.com", password: "password123" })
      ),
    signup: async () =>
      (await import("@/app/affiliates/signup/[program]/createAffiliateSignup")).createAffiliateSignup(
        "p",
        { error: "" },
        form({ name: "Sarah", email: "sarah@example.com", password: "a long enough password" })
      ),
    "set password": async () =>
      (await import("@/app/affiliates/password/setAffiliatePassword")).setAffiliatePassword(
        "t",
        { error: "" },
        form({ password: "a long enough password" })
      ),
    "forgot password": async () =>
      (await import("@/app/affiliates/forgot-password/requestPasswordLink")).requestPasswordLink(
        { sentTo: "" },
        form({ email: "sarah@example.com" })
      ),
    "payout details": async () =>
      (await import("@/app/affiliates/dashboard/updatePayoutDetails")).updatePayoutDetailsAction("PayPal: s@example.com"),
    "promo code": async () => (await import("@/app/affiliates/dashboard/claimPromoCode")).claimPromoCodeAction("SARAH"),
    "create link": async () =>
      (await import("@/app/affiliates/dashboard/links/actions")).createLinkAction({ code: "s", destinationPath: "/" }),
    "update link": async () =>
      (await import("@/app/affiliates/dashboard/links/actions")).updateLinkAction("l1", { code: "s", destinationPath: "/" }),
    "delete link": async () => (await import("@/app/affiliates/dashboard/links/actions")).deleteLinkAction("l1"),
  };

  it.each(Object.keys(pages))("sends the %s page to the paused page", async (name) => {
    expect(await outcome(pages[name])).toBe("redirect:/affiliates/paused");
    expect(touched).toEqual([]);
    expect(serves).toHaveBeenCalledWith("owner-1");
  });

  it.each(Object.keys(actions))("refuses the %s action without changing anything", async (name) => {
    expect(await outcome(actions[name])).toBe("redirect:/affiliates/paused");
    expect(touched).toEqual([]);
    expect(signIn).not.toHaveBeenCalled();
  });

  function authPost(path: string) {
    return new NextRequest(`https://${HOST}/api/auth/${path}`, {
      method: "POST",
      headers: { host: HOST, "content-type": "application/x-www-form-urlencoded" },
      body: "email=a%40example.com&password=password123",
    });
  }

  it("refuses the affiliate sign-in posted to Auth.js before it runs", async () => {
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    const response = await POST(authPost("callback/affiliate-password"));
    expect(response.status).toBe(403);
    expect(authPostHandler).not.toHaveBeenCalled();
    expect(serves).toHaveBeenCalledWith("owner-1");
  });

  it("passes the affiliate sign-in to Auth.js once the product is served", async () => {
    serves.mockResolvedValue(true);
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    expect((await POST(authPost("callback/affiliate-password"))).status).toBe(302);
    expect(authPostHandler).toHaveBeenCalledTimes(1);
  });

  it("leaves every other Auth.js request alone", async () => {
    const { POST } = await import("@/app/api/auth/[...nextauth]/route");
    expect((await POST(authPost("callback/credentials"))).status).toBe(302);
    expect((await POST(authPost("signout"))).status).toBe(302);
    expect(serves).not.toHaveBeenCalled();
  });

  it("shows the paused card while the product is not served", async () => {
    const { default: Paused } = await import("@/app/affiliates/paused/page");
    const html = renderToStaticMarkup((await Paused()) as ReactElement);
    expect(html).toContain("This affiliate program is paused");
    expect(html).toContain("Check back later.");
    expect(html).not.toContain("—");
  });

  it("sends the paused page back to the program once the product is served", async () => {
    serves.mockResolvedValue(true);
    const { default: Paused } = await import("@/app/affiliates/paused/page");
    expect(await outcome(Paused)).toBe("redirect:/affiliates");
  });

  it("answers not found for the paused page off a product's domain", async () => {
    getMerchantByDomain.mockResolvedValueOnce(null);
    const { default: Paused } = await import("@/app/affiliates/paused/page");
    expect(await outcome(Paused)).toBe("notFound");
    expect(serves).not.toHaveBeenCalled();
  });
});
