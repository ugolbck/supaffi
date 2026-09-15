import { describe, it, expect } from "vitest";
import type Stripe from "stripe";
import { checkoutSessionBaseMinor, invoiceBaseMinor, invoiceLinesBeforeTax, scaleToAmountPaid } from "@/lib/worker/saleBase";

// A Session read back with its tax breakdown expanded. A case that gives
// total_details without a breakdown gets an empty one, as a sale with no tax.
function session(fields: Record<string, unknown>): Stripe.Checkout.Session {
  const merged: Record<string, unknown> = {
    amount_total: 5000,
    total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0 },
    shipping_cost: null,
    ...fields,
  };
  const details = merged.total_details as Record<string, unknown> | null;
  if (details && !("breakdown" in details)) merged.total_details = { ...details, breakdown: { discounts: [], taxes: [] } };
  return merged as unknown as Stripe.Checkout.Session;
}

function invoice(fields: Record<string, unknown>): Stripe.Invoice {
  return {
    total: 10000,
    total_excluding_tax: 10000,
    total_taxes: [],
    amount_paid: 10000,
    shipping_cost: null,
    ...fields,
  } as unknown as Stripe.Invoice;
}

describe("checkoutSessionBaseMinor", () => {
  it("takes tax added at checkout off the base", () => {
    // A 50.00 US sale with 4.00 sales tax on top.
    expect(checkoutSessionBaseMinor(session({ amount_total: 5400, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 400 } }))).toBe(5000);
  });

  it("takes VAT already inside the price off the base", () => {
    // A 120.00 EUR price including 20.00 VAT is 100.00 of revenue.
    expect(checkoutSessionBaseMinor(session({ amount_total: 12000, total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 2000 } }))).toBe(10000);
  });

  it("keeps the discount in the base, since the customer never paid it", () => {
    // amount_subtotal would be 5000 here; the base follows amount_total.
    expect(checkoutSessionBaseMinor(session({ amount_subtotal: 5000, amount_total: 4000, total_details: { amount_discount: 1000, amount_shipping: 0, amount_tax: 0 } }))).toBe(4000);
  });

  it("takes the full shipping cost off the base, even if that double-removes its tax", () => {
    // 50.00 goods + 10.00 shipping, 6.00 tax across both (1.00 of it on
    // shipping, already inside the 6.00 total_details.amount_tax). Whether
    // shipping's own tax counts toward amount_tax or the breakdown is
    // undocumented, so shipping_cost.amount_total (11.00, tax included) comes
    // off in full rather than shipping_cost.amount_total less
    // shipping_cost.amount_tax: the 1.00 shipping tax is removed twice here,
    // at the cost of a small affiliate underpay, rather than risk ever
    // leaving it in the base.
    expect(
      checkoutSessionBaseMinor(
        session({
          amount_total: 6600,
          total_details: { amount_discount: 0, amount_shipping: 1000, amount_tax: 600 },
          shipping_cost: { amount_subtotal: 1000, amount_tax: 100, amount_total: 1100 },
        })
      )
    ).toBe(4900);
  });

  it("comes to nothing when only shipping was paid", () => {
    expect(
      checkoutSessionBaseMinor(
        session({ amount_total: 500, shipping_cost: { amount_subtotal: 500, amount_tax: 0, amount_total: 500 } })
      )
    ).toBe(0);
  });

  it("refuses to guess when the tax breakdown is missing", () => {
    expect(checkoutSessionBaseMinor(session({ total_details: null }))).toBeNull();
    expect(checkoutSessionBaseMinor(session({ amount_total: null }))).toBeNull();
  });

  it("takes tax inside the price off even when amount_tax leaves it out", () => {
    // 120.00 EUR with 20.00 VAT inside, reported only in the breakdown.
    expect(
      checkoutSessionBaseMinor(
        session({
          amount_total: 12000,
          total_details: {
            amount_discount: 0,
            amount_shipping: 0,
            amount_tax: 0,
            breakdown: { discounts: [], taxes: [{ amount: 2000, rate: { inclusive: true } }] },
          },
        })
      )
    ).toBe(10000);
  });

  it("takes amount_tax off when the breakdown lists less", () => {
    expect(
      checkoutSessionBaseMinor(
        session({
          amount_total: 12000,
          total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 2000, breakdown: { discounts: [], taxes: [] } },
        })
      )
    ).toBe(10000);
  });

  it("refuses to guess when the Session was not read with its breakdown", () => {
    expect(
      checkoutSessionBaseMinor(
        session({ total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0, breakdown: undefined } })
      )
    ).toBeNull();
    expect(
      checkoutSessionBaseMinor(session({ total_details: { amount_discount: 0, amount_shipping: 0, amount_tax: 0, breakdown: null } }))
    ).toBeNull();
  });

  it("never uses amount_subtotal, which holds tax inside an inclusive price", () => {
    expect(
      checkoutSessionBaseMinor(
        session({
          amount_subtotal: 12000,
          amount_total: 12000,
          total_details: {
            amount_discount: 0,
            amount_shipping: 0,
            amount_tax: 2000,
            breakdown: { discounts: [], taxes: [{ amount: 2000, rate: { inclusive: true } }] },
          },
        })
      )
    ).toBe(10000);
  });
});

describe("invoiceBaseMinor", () => {
  it("gives 100.00 on a 120.00 EUR invoice with 20.00 VAT included in the price", () => {
    expect(
      invoiceBaseMinor(invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: [{ amount: 2000 }], amount_paid: 12000 }))
    ).toBe(10000);
  });

  it("takes tax added on top off the base", () => {
    expect(
      invoiceBaseMinor(invoice({ total: 10800, total_excluding_tax: 10000, total_taxes: [{ amount: 800 }], amount_paid: 10800 }))
    ).toBe(10000);
  });

  it("works from the tax lines when total_excluding_tax is missing", () => {
    expect(
      invoiceBaseMinor(invoice({ total: 12000, total_excluding_tax: null, total_taxes: [{ amount: 1500 }, { amount: 500 }], amount_paid: 12000 }))
    ).toBe(10000);
  });

  it("works from the older tax field an endpoint on an old API version still sends", () => {
    expect(
      invoiceBaseMinor(
        invoice({ total: 12000, total_excluding_tax: null, total_taxes: undefined, total_tax_amounts: [{ amount: 2000, inclusive: true }], amount_paid: 12000 })
      )
    ).toBe(10000);
  });

  it("refuses to fall back to the total, which still has the tax in it", () => {
    expect(invoiceBaseMinor(invoice({ total: 12000, total_excluding_tax: null, total_taxes: null, amount_paid: 12000 }))).toBeNull();
  });

  it("takes shipping off the base", () => {
    expect(
      invoiceBaseMinor(invoice({ total: 6000, total_excluding_tax: 6000, amount_paid: 6000, shipping_cost: { amount_subtotal: 1000, amount_tax: 0, amount_total: 1000 } }))
    ).toBe(5000);
  });

  it("scales the base to what was paid when credit balance covered part of it", () => {
    expect(invoiceBaseMinor(invoice({ total: 12000, total_excluding_tax: 10000, amount_paid: 3000 }))).toBe(2500);
  });

  it("comes to nothing when credit balance covered all of it", () => {
    expect(invoiceBaseMinor(invoice({ amount_paid: 0 }))).toBe(0);
  });

  it("comes to nothing on a fully discounted invoice, without dividing by zero", () => {
    expect(invoiceBaseMinor(invoice({ total: 0, total_excluding_tax: 0, amount_paid: 0 }))).toBe(0);
  });

  it("rounds a scaled half unit up", () => {
    // 101 * 1 / 2 = 50.5 minor units.
    expect(invoiceBaseMinor(invoice({ total: 2, total_excluding_tax: 101, amount_paid: 1 }))).toBe(51);
  });
});

describe("invoiceLinesBeforeTax", () => {
  it("is the total before tax and shipping, not clamped, so lines can be checked against it", () => {
    expect(invoiceLinesBeforeTax(invoice({ total: -500, total_excluding_tax: -500 }))).toBe(-500);
    expect(
      invoiceLinesBeforeTax(invoice({ total: 12000, total_excluding_tax: 11000, shipping_cost: { amount_total: 1200, amount_tax: 200 } }))
    ).toBe(10000);
  });

  it("refuses to guess when the tax breakdown is missing", () => {
    expect(invoiceLinesBeforeTax(invoice({ total_excluding_tax: null, total_taxes: null }))).toBeNull();
  });
});

describe("scaleToAmountPaid", () => {
  it("keeps the base when the invoice was paid in full, and scales it when credit covered part", () => {
    expect(scaleToAmountPaid(8000, { total: 10000, amount_paid: 10000 })).toBe(8000);
    expect(scaleToAmountPaid(8000, { total: 10000, amount_paid: 5000 })).toBe(4000);
    expect(scaleToAmountPaid(8000, { total: 0, amount_paid: 0 })).toBe(0);
  });
});
