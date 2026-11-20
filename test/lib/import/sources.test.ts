// Each tool's API, answered by a stub that knows only the requests the reader
// is documented to make, put in Supaffi's one shape.
import { describe, it, expect, vi, afterEach } from "vitest";
import { fetchRewardful } from "@/lib/import/sources/rewardful";
import { fetchTolt } from "@/lib/import/sources/tolt";
import { fetchFirstPromoter } from "@/lib/import/sources/firstpromoter";
import { fetchAffonso } from "@/lib/import/sources/affonso";

type Route = (url: URL, headers: Headers) => unknown;

function stub(routes: Record<string, Route>) {
  const seen: { url: URL; headers: Headers }[] = [];
  vi.stubGlobal("fetch", async (input: string, init: { headers: Record<string, string> }) => {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    seen.push({ url, headers });
    const route = Object.entries(routes).find(([path]) => url.pathname.endsWith(path));
    if (!route) return new Response("not found", { status: 404 });
    return Response.json(route[1](url, headers));
  });
  return seen;
}

afterEach(() => vi.unstubAllGlobals());

describe("Rewardful", () => {
  it("reads every page with the secret as the Basic user, and turns cents and states into ours", async () => {
    const seen = stub({
      "/campaigns": () => ({ pagination: { next_page: null }, data: [{ id: "c1", name: "Partners" }] }),
      "/affiliates": (url) =>
        url.searchParams.get("page") === "1"
          ? {
              pagination: { next_page: 2 },
              data: [
                {
                  id: "a1",
                  email: "Sarah@Example.com",
                  first_name: "Sarah",
                  last_name: "Lee",
                  paypal_email: "s@paypal.test",
                  campaign: { id: "c1" },
                  links: [{ token: "sarah" }, { token: "sarah-blog" }],
                },
              ],
            }
          : { pagination: { next_page: null }, data: [{ id: "a2", email: "tom@example.com", first_name: null, last_name: null, paypal_email: null, campaign: null }] },
      "/referrals": () => ({
        pagination: { next_page: null },
        data: [{ id: "r1", stripe_customer_id: "cus_1", affiliate: { id: "a1" }, created_at: "2026-01-01T00:00:00Z", became_conversion_at: "2026-01-02T00:00:00Z" }],
      }),
      "/commissions": () => ({
        pagination: { next_page: null },
        data: [
          { id: "k1", amount: 3000, currency: "USD", state: "due", created_at: "2026-01-02T00:00:00Z", paid_at: null, sale: { affiliate: { id: "a1" }, referral: { id: "r1" } } },
          { id: "k2", amount: 1250, currency: "USD", state: "paid", created_at: "2025-12-01T00:00:00Z", paid_at: "2026-01-15T00:00:00Z", sale: { affiliate: { id: "a1" }, referral: null } },
        ],
      }),
    });

    const program = await fetchRewardful("sk_secret");

    expect(seen[0].headers.get("authorization")).toBe(`Basic ${Buffer.from("sk_secret:").toString("base64")}`);
    expect(program.affiliates.map((a) => [a.id, a.name, a.codes, a.paypalEmail])).toEqual([
      ["a1", "Sarah Lee", ["sarah", "sarah-blog"], "s@paypal.test"],
      ["a2", null, [], null],
    ]);
    expect(program.referrals).toEqual([
      { id: "r1", affiliateId: "a1", stripeCustomerId: "cus_1", subscriptionId: null, createdAt: "2026-01-02T00:00:00Z" },
    ]);
    expect(program.commissions.map((c) => [c.id, c.amount, c.currency, c.state, c.referralId])).toEqual([
      ["k1", "30.00", "usd", "owed", "r1"],
      ["k2", "12.50", "usd", "paid", null],
    ]);
  });
});

describe("Tolt", () => {
  it("follows cursors and keeps reading the parameter most links use", async () => {
    stub({
      "/programs": () => ({ data: [{ id: "prg_1", name: "Main" }], has_more: false }),
      "/partners": (url) =>
        url.searchParams.get("starting_after")
          ? { data: [{ id: "part_2", email: "b@example.com", first_name: null, last_name: null, program_id: "prg_1" }], has_more: false }
          : { data: [{ id: "part_1", email: "a@example.com", first_name: "Ann", last_name: null, program_id: "prg_1" }], has_more: true, next_cursor: "part_1" },
      "/links": () => ({ data: [{ value: "ann", param: "ref", partner_id: "part_1" }, { value: "b", param: "ref", partner_id: "part_2" }, { value: "b2", param: "aff", partner_id: "part_2" }], has_more: false }),
      "/customers": () => ({ data: [{ id: "cus_t1", partner_id: "part_1", customer_id: "cus_stripe", subscription_id: "sub_1", created_at: "2026-01-01T00:00:00Z" }], has_more: false }),
      "/commissions": () => ({ data: [{ id: "comm_1", amount: "4900", currency: "usd", status: "approved", partner_id: "part_1", customer_id: "cus_t1", created_at: "2026-01-01T00:00:00Z", updated_at: null }], has_more: false }),
    });

    const program = await fetchTolt("key");

    expect(program.referralParam).toBe("ref");
    expect(program.affiliates.map((a) => [a.id, a.codes])).toEqual([["part_1", ["ann"]], ["part_2", ["b", "b2"]]]);
    expect(program.referrals[0]).toMatchObject({ stripeCustomerId: "cus_stripe", subscriptionId: "sub_1" });
    expect(program.commissions[0]).toMatchObject({ amount: "49.00", state: "owed", referralId: "cus_t1" });
  });
});

describe("FirstPromoter", () => {
  it("sends the account id, reads payout emails per promoter and keeps only cash rewards", async () => {
    const seen = stub({
      "/campaigns": () => [{ id: 1, name: "Default", ref_token_param: "fpr" }],
      "/promoters": () => ({ data: [{ id: 7, email: "p@example.com", name: "Pat", promoter_campaigns: [{ campaign_id: 1, ref_token: "pat" }] }] }),
      "/payout_methods": () => [{ method: "paypal", is_selected: true, details: { paypal_email: "pat@paypal.test" } }],
      "/referrals": () => [{ id: 3, uid: "cus_fp", created_at: "2026-01-01T00:00:00Z", promoter_campaign: { promoter_id: 7 } }],
      "/commissions": () => [
        { id: 9, status: "approved", is_paid: true, amount: 2000, unit: "cash", original_sale_currency: "EUR", created_at: "2026-01-01T00:00:00Z", status_updated_at: "2026-02-01T00:00:00Z", promoter_campaign: { promoter_id: 7 }, referral: { id: 3 } },
        { id: 10, status: "approved", is_paid: false, amount: 5, unit: "points", original_sale_currency: null, created_at: "2026-01-01T00:00:00Z", status_updated_at: null, promoter_campaign: { promoter_id: 7 }, referral: null },
      ],
    });

    const program = await fetchFirstPromoter("key", "acc_1");

    expect(seen.every((r) => r.headers.get("account-id") === "acc_1")).toBe(true);
    expect(program.referralParam).toBe("fpr");
    expect(program.affiliates[0]).toMatchObject({ id: "7", codes: ["pat"], paypalEmail: "pat@paypal.test", campaignId: "1" });
    expect(program.referrals[0]).toMatchObject({ id: "3", affiliateId: "7", stripeCustomerId: "cus_fp" });
    expect(program.commissions).toEqual([
      { id: "9", affiliateId: "7", referralId: "3", amount: "20.00", currency: "eur", state: "paid", createdAt: "2026-01-01T00:00:00Z", paidAt: "2026-02-01T00:00:00Z" },
    ]);
  });
});

describe("Affonso", () => {
  it("reads the one program, its parameter, and amounts already in major units", async () => {
    stub({
      "/program": () => ({ data: { id: "prog", name: "Affonso program", default_referral_parameter: "atp" } }),
      "/affiliates": () => ({ data: [{ id: "af1", name: "Lia", email: "lia@example.com", tracking_id: "lia", payoutMethod: { type: "wise", details: { email: "lia@wise.test" } } }], pagination: { hasNextPage: false } }),
      "/referrals": () => ({ data: [{ id: "rf1", affiliate_id: "af1", customer_id: "cus_a", subscription_id: "sub_a", created_at: "2026-01-01T00:00:00Z", converted_at: null }], has_more: false }),
      "/commissions": () => ({ data: [{ id: "cm1", referral_id: "rf1", affiliate_id: "af1", commission_amount: 9.9, commission_currency: "USD", status: "pending_manual_approval", created_at: "2026-01-01T00:00:00Z", updated_at: null }], pagination: { has_next_page: false } }),
    });

    const program = await fetchAffonso("key");

    expect(program.referralParam).toBe("atp");
    expect(program.campaigns).toEqual([{ id: "prog", name: "Affonso program" }]);
    expect(program.affiliates[0]).toMatchObject({ codes: ["lia"], wiseEmail: "lia@wise.test", campaignId: "prog" });
    expect(program.referrals[0]).toMatchObject({ stripeCustomerId: "cus_a", subscriptionId: "sub_a" });
    expect(program.commissions[0]).toMatchObject({ amount: "9.90", currency: "usd", state: "pending" });
  });

  it("says the key was refused in words the owner can act on", async () => {
    vi.stubGlobal("fetch", async () => new Response("no", { status: 401 }));
    await expect(fetchAffonso("bad")).rejects.toThrow("Affonso refused the API key. Check it and start again.");
  });
});
