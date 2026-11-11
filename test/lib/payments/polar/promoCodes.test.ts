import { describe, it, expect, vi, afterEach } from "vitest";
import { encrypt } from "@/lib/crypto";
import { polarDiscountLabel, polarPromoCodes } from "@/lib/payments/polar/promoCodes";

const merchant = { paymentKeyEnc: encrypt("polar_oat_x"), paymentSandbox: false };

function answer(status: number, body: unknown = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const base = { ends_at: null, max_redemptions: null, redemptions_count: 0, products: [], metadata: {} };
const partner = { ...base, id: "d_partner", name: "Partners", code: null, type: "percentage", basis_points: 2000, duration: "repeating", duration_in_months: 3 };

afterEach(() => vi.unstubAllGlobals());

describe("polarDiscountLabel", () => {
  it("says what a discount gives, as for a Stripe coupon", () => {
    expect(polarDiscountLabel(partner as never)).toBe("20% off for 3 months");
    expect(polarDiscountLabel({ ...partner, basis_points: 1250, duration: "forever" } as never)).toBe("12.5% off forever");
    expect(
      polarDiscountLabel({ ...base, id: "f", name: "F", code: null, type: "fixed", amount: 1000, currency: "usd", duration: "once" } as never)
    ).toBe("$10 off the first payment");
    expect(polarDiscountLabel({ ...base, id: "f", name: "F", code: null, type: "fixed", amounts: { eur: 500 }, duration: "once" } as never)).toContain(
      "5"
    );
  });
});

describe("polarPromoCodes", () => {
  it("offers the discounts still usable, never the affiliates' own codes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        answer(200, {
          items: [
            partner,
            { ...partner, id: "d_ended", ends_at: "2020-01-01T00:00:00Z" },
            { ...partner, id: "d_used", max_redemptions: 5, redemptions_count: 5 },
            { ...partner, id: "d_code", code: "ALICE20", metadata: { supaffi_affiliate_id: "a1" } },
          ],
        })
      )
    );
    expect(await polarPromoCodes.listDiscounts(merchant)).toEqual({
      ok: true,
      coupons: [{ id: "d_partner", name: "Partners", label: "20% off for 3 months" }],
    });
  });

  it("asks for the discounts scope when the token lacks it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(403, { error: "insufficient_scope" })));
    expect(await polarPromoCodes.listDiscounts(merchant)).toEqual({
      ok: false,
      error: "Your Polar token can't read discounts.",
      keyLacksPermission: true,
    });
  });

  it("finds a code by its exact text, any case, and refuses a guess", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => answer(200, { items: [{ ...partner, id: "d1", code: "SUMMER" }, { ...partner, id: "d2", code: "SUMMER2" }] }))
    );
    expect(await polarPromoCodes.findCode(merchant, "summer")).toEqual({ ok: true, ref: "d1", code: "SUMMER" });
    expect((await polarPromoCodes.findCode(merchant, "WINTER")).ok).toBe(false);
  });

  it("creates an affiliate's code as a copy of the program's discount, once per customer", async () => {
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") return answer(201, { ...partner, id: "d_new", code: "BOB20" });
      if (url.includes("?query=")) return answer(200, { items: [] });
      return answer(200, { ...partner, products: [{ id: "prod_1" }] });
    });
    vi.stubGlobal("fetch", fetch);
    const result = await polarPromoCodes.createCode(merchant, { discountRef: "d_partner", code: "BOB20", affiliateId: "a1", attempt: 0 });
    expect(result).toEqual({ ok: true, ref: "d_new", code: "BOB20" });
    const post = fetch.mock.calls.find(([, init]) => init.method === "POST")!;
    expect(JSON.parse(String(post[1].body))).toEqual({
      name: "Partners BOB20",
      code: "BOB20",
      type: "percentage",
      basis_points: 2000,
      duration: "repeating",
      duration_in_months: 3,
      products: ["prod_1"],
      max_redemptions_per_customer: 1,
      metadata: { supaffi_affiliate_id: "a1" },
    });
  });

  it("refuses a code another discount already uses, before creating anything", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("?query=") ? answer(200, { items: [{ ...partner, code: "BOB20" }] }) : answer(200, partner)
    );
    vi.stubGlobal("fetch", fetch);
    expect(await polarPromoCodes.createCode(merchant, { discountRef: "d_partner", code: "bob20", affiliateId: "a1", attempt: 0 })).toEqual({
      ok: false,
      error: "That code is taken",
    });
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("copies a fixed amount and the discount's end, and refuses a model that has ended", async () => {
    const fixed = { ...base, id: "d_fixed", name: "Launch", code: null, type: "fixed", amount: 1000, currency: "usd", amounts: { usd: 1000 }, duration: "once", ends_at: "2999-01-01T00:00:00Z" };
    const fetch = vi.fn(async (url: string, init: RequestInit) => {
      if (init.method === "POST") return answer(201, { ...fixed, id: "d_new", code: "BOB10" });
      if (url.includes("?query=")) return answer(200, { items: [] });
      return answer(200, fixed);
    });
    vi.stubGlobal("fetch", fetch);
    await polarPromoCodes.createCode(merchant, { discountRef: "d_fixed", code: "BOB10", affiliateId: "a1", attempt: 0 });
    const body = JSON.parse(String(fetch.mock.calls.find(([, init]) => init.method === "POST")![1].body));
    expect(body).toMatchObject({ type: "fixed", amounts: { usd: 1000 }, duration: "once", ends_at: "2999-01-01T00:00:00Z" });
    expect(body).not.toHaveProperty("duration_in_months");

    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("?query=") ? answer(200, { items: [] }) : answer(200, { ...fixed, ends_at: "2020-01-01T00:00:00Z" }))));
    expect(await polarPromoCodes.createCode(merchant, { discountRef: "d_fixed", code: "BOB10", affiliateId: "a1", attempt: 0 })).toEqual({
      ok: false,
      error: "The program's discount can no longer be used",
    });
  });

  it("adopts the affiliate's own code when a create's answer was lost, rather than calling it taken", async () => {
    const fetch = vi.fn(async (url: string, _init?: RequestInit) =>
      url.includes("?query=")
        ? answer(200, { items: [{ ...partner, id: "d_mine", code: "BOB20", metadata: { supaffi_affiliate_id: "a1" } }] })
        : answer(200, partner)
    );
    vi.stubGlobal("fetch", fetch);
    expect(await polarPromoCodes.createCode(merchant, { discountRef: "d_partner", code: "BOB20", affiliateId: "a1", attempt: 0 })).toEqual({
      ok: true,
      ref: "d_mine",
      code: "BOB20",
    });
    expect(fetch.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
  });

  it("deletes a code it made, and takes one already gone as done", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(204)));
    expect(await polarPromoCodes.deactivateCode(merchant, "d_new")).toEqual({ ok: true });
    vi.stubGlobal("fetch", vi.fn(async () => answer(404)));
    expect(await polarPromoCodes.deactivateCode(merchant, "d_new")).toEqual({ ok: true });
  });
});
