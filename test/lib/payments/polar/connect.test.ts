import { describe, it, expect, vi, afterEach } from "vitest";
import { polarTokenWorks, createPolarWebhookEndpoint } from "@/lib/payments/polar/connect";
import { POLAR_API_VERSION } from "@/lib/payments/polar/api";

function answer(status: number, body: unknown = {}) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => vi.unstubAllGlobals());

describe("polarTokenWorks", () => {
  it("refuses anything that is not an organization token, without a call", async () => {
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);
    expect((await polarTokenWorks("sk_live_x")).ok).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("finds a production token on production, with the version pinned", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer(200, { items: [] }));
    vi.stubGlobal("fetch", fetch);
    expect(await polarTokenWorks("polar_oat_x")).toEqual({ ok: true, detail: "Token works", sandbox: false });
    expect(fetch.mock.calls[0][0]).toBe("https://api.polar.sh/v1/webhooks/endpoints?limit=1");
    expect((fetch.mock.calls[0][1].headers as Record<string, string>)["Polar-Version"]).toBe(POLAR_API_VERSION);
  });

  it("finds a sandbox token when production does not know it", async () => {
    const fetch = vi.fn(async (url: string) => (url.startsWith("https://sandbox-api.polar.sh") ? answer(200, { items: [] }) : answer(401)));
    vi.stubGlobal("fetch", fetch);
    expect(await polarTokenWorks("polar_oat_x")).toEqual({ ok: true, detail: "Token works", sandbox: true });
  });

  it("names the scopes when the token lacks one", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(403, { error: "insufficient_scope" })));
    const result = await polarTokenWorks("polar_oat_x");
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("webhooks:write");
  });

  it("says a token neither environment knows is not valid", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(401)));
    expect(await polarTokenWorks("polar_oat_x")).toEqual({ ok: false, detail: "Polar says this token is not valid" });
  });
});

describe("createPolarWebhookEndpoint", () => {
  it("creates a raw endpoint for the handled events and keeps Polar's secret", async () => {
    const fetch = vi.fn(async (_url: string, _init: RequestInit) => answer(201, { id: "we_1", url: "u", events: [], secret: "whsec_s" }));
    vi.stubGlobal("fetch", fetch);
    const result = await createPolarWebhookEndpoint({ token: "polar_oat_x", sandbox: true }, "https://a.example.com/api/webhooks/polar", "Acme");
    expect(result).toEqual({ ok: true, id: "we_1", secret: "whsec_s" });
    expect(fetch.mock.calls[0][0]).toBe("https://sandbox-api.polar.sh/v1/webhooks/endpoints");
    expect(JSON.parse(String(fetch.mock.calls[0][1].body))).toEqual({
      url: "https://a.example.com/api/webhooks/polar",
      name: "Supaffi: Acme",
      format: "raw",
      events: ["order.paid", "order.refunded", "subscription.revoked"],
    });
  });

  it("says what is wrong with a token that cannot create it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(403)));
    expect(await createPolarWebhookEndpoint({ token: "polar_oat_x", sandbox: false }, "https://a/x", "Acme")).toEqual({
      ok: false,
      detail: "That token cannot create webhook endpoints.",
    });
  });
});
