import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";

import { discountLabel, listCoupons, suggestedCode } from "@/lib/coupon";

const coupon = (fields: Partial<Stripe.Coupon>) =>
  ({ percent_off: null, amount_off: null, currency: null, duration: "forever", duration_in_months: null, ...fields }) as Stripe.Coupon;

describe("coupon", () => {
  it("says what a coupon gives, in each of Stripe's durations", () => {
    expect(discountLabel(coupon({ percent_off: 20, duration: "repeating", duration_in_months: 3 }))).toBe("20% off for 3 months");
    expect(discountLabel(coupon({ percent_off: 12.5, duration: "repeating", duration_in_months: 1 }))).toBe("12.5% off for 1 month");
    expect(discountLabel(coupon({ percent_off: 50, duration: "forever" }))).toBe("50% off forever");
    expect(discountLabel(coupon({ amount_off: 1000, currency: "usd", duration: "once" }))).toBe("$10 off the first payment");
    expect(discountLabel(coupon({ amount_off: 1050, currency: "eur", duration: "once" }))).toBe("€10.50 off the first payment");
  });

  it("suggests the link code in capitals, with the percentage", () => {
    expect(suggestedCode("alice", "20% off for 3 months")).toBe("ALICE20");
    expect(suggestedCode("sarah-jones", "$10 off the first payment")).toBe("SARAHJONES");
    expect(suggestedCode("a-very-long-creator-name", "15% off forever")).toBe("AVERYLONGCREATORNA15");
  });

  it("lists only coupons that can still be applied", async () => {
    const stripe = {
      coupons: {
        list: vi.fn(async () => ({
          data: [
            { ...coupon({ percent_off: 20 }), id: "c1", name: "Partners", valid: true },
            { ...coupon({ percent_off: 90 }), id: "c2", name: null, valid: false },
          ],
        })),
      },
    } as unknown as Stripe;

    expect(await listCoupons(stripe)).toEqual({ ok: true, coupons: [{ id: "c1", name: "Partners", label: "20% off forever" }] });
  });

  it("tells a key that cannot read coupons from Stripe being down", async () => {
    const failing = (error: object) =>
      ({ coupons: { list: vi.fn(async () => Promise.reject(Object.assign(new Error("x"), error))) } }) as unknown as Stripe;

    expect(await listCoupons(failing({ type: "StripeInvalidRequestError" }))).toEqual({
      ok: false,
      error: "Your Stripe key can't read coupons.",
      keyLacksPermission: true,
    });
    expect(await listCoupons(failing({ type: "StripeConnectionError" }))).toEqual({
      ok: false,
      error: "Stripe could not be reached. Try again.",
    });
  });
});
