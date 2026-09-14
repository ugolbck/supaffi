import { describe, it, expect, vi } from "vitest";
import type Stripe from "stripe";
import { listInvoiceLines, referredInvoiceBase } from "@/lib/worker/referredRevenue";
import { invoiceLine, LINE_SUBSCRIPTION_ID, PRODUCT_ID } from "./invoiceLines";

const SUB = LINE_SUBSCRIPTION_ID;
const REFERRED = [PRODUCT_ID];

// Paid in full, no shipping. Each case sets the totals Stripe would compute
// for its lines.
function invoice(fields: Record<string, unknown>) {
  return {
    total: 10000,
    total_excluding_tax: 10000,
    total_taxes: [],
    amount_paid: (fields.total as number | undefined) ?? 10000,
    shipping_cost: null,
    ...fields,
  } as unknown as Stripe.Invoice;
}

const inclusive = (amount: number) => [{ amount, tax_behavior: "inclusive", taxable_amount: null }];

describe("referredInvoiceBase", () => {
  describe("tax and discounts", () => {
    it("takes VAT inside the price off a subscription line", () => {
      const result = referredInvoiceBase(
        invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: inclusive(2000) }),
        [invoiceLine({ amount: 12000, inclusiveTax: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 10000,
        referredChargeMinor: 12000,
        productIds: REFERRED,
        otherProductIds: [],
      });
    });

    it("leaves tax added on top out, since it was never in the line's amount", () => {
      const result = referredInvoiceBase(
        invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: [{ amount: 2000, tax_behavior: "exclusive" }] }),
        [invoiceLine({ amount: 10000, exclusiveTax: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 10000 });
    });

    it("takes a discount off, once, when the line's amount is before discounts", () => {
      // 120.00 with 20% VAT inside, 20% off: 96.00 paid, 16.00 of it VAT.
      const result = referredInvoiceBase(
        invoice({ total: 9600, total_excluding_tax: 8000, total_taxes: inclusive(1600) }),
        [invoiceLine({ amount: 12000, discount: 2400, inclusiveTax: 1600 })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 8000 });
    });

    it("does not take a discount off twice when the line's amount already has it off", () => {
      const result = referredInvoiceBase(
        invoice({ total: 8000, total_excluding_tax: 8000 }),
        [invoiceLine({ amount: 8000, discount: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 8000 });
    });

    it("reads the discount from discount_amounts when pretax_credit_amounts is absent", () => {
      const result = referredInvoiceBase(
        invoice({ total: 8000, total_excluding_tax: 8000 }),
        [invoiceLine({ amount: 10000, discount: 2000, creditsIn: "discount_amounts_only" })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 8000 });
    });

    it("scales the referred base to what was paid when credit balance covered part", () => {
      const result = referredInvoiceBase(
        invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: inclusive(2000), amount_paid: 6000 }),
        [invoiceLine({ amount: 12000, inclusiveTax: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 5000 });
    });

    it("earns nothing when the invoice was paid entirely outside Stripe", () => {
      const result = referredInvoiceBase(
        invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: inclusive(2000), amount_paid_off_stripe: 12000 }),
        [invoiceLine({ amount: 12000, inclusiveTax: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({ kind: "off_stripe" });
    });

    it("scales the base to the part paid through Stripe when the rest was paid outside it", () => {
      const result = referredInvoiceBase(
        invoice({ total: 12000, total_excluding_tax: 10000, total_taxes: inclusive(2000), amount_paid_off_stripe: 6000 }),
        [invoiceLine({ amount: 12000, inclusiveTax: 2000 })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 5000 });
    });

    it("says so when the invoice does not carry its tax", () => {
      const result = referredInvoiceBase(
        invoice({ total_excluding_tax: null, total_taxes: null }),
        [invoiceLine({ amount: 10000 })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({ kind: "no_tax_breakdown" });
    });
  });

  describe("which lines are referred", () => {
    it("leaves out a one-off item of the customer swept into the renewal", () => {
      const result = referredInvoiceBase(
        invoice({ total: 15000, total_excluding_tax: 15000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 5000, source: "invoice_item" })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 10000,
        referredChargeMinor: 10000,
        productIds: REFERRED,
        otherProductIds: [],
      });
    });

    it("leaves out a one-off item the merchant added to the subscription itself", () => {
      const result = referredInvoiceBase(
        invoice({ total: 15000, total_excluding_tax: 15000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 5000, source: "invoice_item", subscription: SUB })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 10000 });
    });

    it("counts the prorations of a plan change inside the same product", () => {
      // 50.00 back for the old price's unused half, 80.00 for the new one's.
      const result = referredInvoiceBase(
        invoice({ total: 3000, total_excluding_tax: 3000 }),
        [invoiceLine({ amount: -5000, proration: true }), invoiceLine({ amount: 8000, proration: true })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 3000 });
    });

    it("counts a proration Stripe billed as an invoice item of the subscription", () => {
      const result = referredInvoiceBase(
        invoice({ total: 13000, total_excluding_tax: 13000 }),
        [
          invoiceLine({ amount: 10000 }),
          invoiceLine({ amount: 3000, source: "invoice_item", subscription: SUB, proration: true }),
        ],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 13000 });
    });

    it("earns nothing on another product's price, and names it", () => {
      const result = referredInvoiceBase(
        invoice({ total: 15000, total_excluding_tax: 15000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 5000, product: "prod_other" })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 10000,
        referredChargeMinor: 10000,
        productIds: REFERRED,
        otherProductIds: ["prod_other"],
      });
    });

    it("earns nothing at all after a switch to another product", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, product: "prod_other" })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 0, otherProductIds: ["prod_other"] });
    });

    it("never earns more than the invoice before tax when a credit item lowered it", () => {
      const result = referredInvoiceBase(
        invoice({ total: 7000, total_excluding_tax: 7000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: -3000, source: "invoice_item" })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 7000 });
    });
  });

  // A negative invoice item is Stripe's documented credit ("Passing in a
  // negative amount will reduce the amount_due on the invoice"). Supaffi
  // cannot tell which product a bare credit was meant for, so it must not be
  // assumed to leave the referred product's own base untouched: it is
  // subtracted before the clamp, not only once it outweighs every other line.
  describe("a credit line not tied to any product", () => {
    it("lowers the referred base even with a non-referred line still on the invoice", () => {
      // Referred plan A 100.00, non-referred add-on B 50.00, a 40.00 goodwill
      // credit naming no subscription: 100.00 - 40.00 = 60.00 earns, not 100.00.
      const result = referredInvoiceBase(
        invoice({ total: 11000, total_excluding_tax: 11000 }),
        [
          invoiceLine({ amount: 10000 }),
          invoiceLine({ amount: 5000, product: "prod_addon" }),
          invoiceLine({ amount: -4000, source: "invoice_item" }),
        ],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 6000,
        referredChargeMinor: 6000,
        productIds: REFERRED,
        otherProductIds: ["prod_addon"],
      });
    });

    it("lowers the referred base when the credit is the only other line on the invoice", () => {
      const result = referredInvoiceBase(
        invoice({ total: 6000, total_excluding_tax: 6000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: -4000, source: "invoice_item" })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 6000,
        referredChargeMinor: 6000,
        productIds: REFERRED,
        otherProductIds: [],
      });
    });

    it("leaves a negative proration of another product out, since it already belongs to that product", () => {
      // A downgrade credit for a different, non-referred product on the same
      // subscription must not spill onto the referred base either.
      const result = referredInvoiceBase(
        invoice({ total: 8000, total_excluding_tax: 8000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: -2000, proration: true, product: "prod_other" })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 8000,
        referredChargeMinor: 8000,
        productIds: REFERRED,
        otherProductIds: ["prod_other"],
      });
    });
  });

  // Stripe's API reference does not say when a subscription_item_details
  // line's `subscription` field comes back null, so it is never assumed to
  // belong to the referred subscription on its own. It is placed by its
  // subscription_item id instead, against a list of the referred
  // subscription's own item ids that the caller may optionally supply.
  // Naming a different, non-null subscription is simply not referred, the
  // same as an unrelated one-off item, rather than making the whole invoice
  // unreadable. A proration invoice item rides on any subscription's invoice
  // when Stripe leaves its subscription blank, so a null one there is not
  // referred either; only an exact match on the referred subscription's id is.
  describe("a line's own subscription id can be missing", () => {
    it("earns on a null-subscription line whose item is in the supplied list", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, subscription: null })],
        SUB,
        REFERRED,
        ["si_basic"]
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 10000,
        referredChargeMinor: 10000,
        productIds: REFERRED,
        otherProductIds: [],
      });
    });

    it("earns nothing on the same line when no item list is supplied", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, subscription: null })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({ kind: "earned", baseMinor: 0, referredChargeMinor: 0, productIds: REFERRED, otherProductIds: [] });
    });

    it("earns nothing on a null-subscription line whose item is not in the supplied list", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, subscription: null })],
        SUB,
        REFERRED,
        ["si_other"]
      );
      expect(result).toEqual({ kind: "earned", baseMinor: 0, referredChargeMinor: 0, productIds: REFERRED, otherProductIds: [] });
    });

    it("earns nothing on a subscription line naming another subscription, without failing the whole invoice", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, subscription: "sub_other" })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({ kind: "earned", baseMinor: 0, referredChargeMinor: 0, productIds: REFERRED, otherProductIds: [] });
    });

    it("earns nothing on a proration invoice item with no subscription id", () => {
      const result = referredInvoiceBase(
        invoice({ total: 3000, total_excluding_tax: 3000 }),
        [invoiceLine({ amount: 3000, source: "invoice_item", subscription: null, proration: true })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 0 });
    });

    it("earns on a proration invoice item that names the referred subscription exactly", () => {
      const result = referredInvoiceBase(
        invoice({ total: 3000, total_excluding_tax: 3000 }),
        [invoiceLine({ amount: 3000, source: "invoice_item", subscription: SUB, proration: true })],
        SUB,
        REFERRED
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 3000,
        referredChargeMinor: 3000,
        productIds: REFERRED,
        otherProductIds: [],
      });
    });

    it("earns nothing on a subscription line naming another subscription even when its item is in the supplied list", () => {
      const result = referredInvoiceBase(
        invoice({ total: 10000, total_excluding_tax: 10000 }),
        [invoiceLine({ amount: 10000, subscription: "sub_other" })],
        SUB,
        REFERRED,
        ["si_basic"]
      );
      expect(result).toEqual({ kind: "earned", baseMinor: 0, referredChargeMinor: 0, productIds: REFERRED, otherProductIds: [] });
    });

    it("earns nothing on a proration invoice item naming another subscription", () => {
      const result = referredInvoiceBase(
        invoice({ total: 3000, total_excluding_tax: 3000 }),
        [invoiceLine({ amount: 3000, source: "invoice_item", subscription: "sub_other", proration: true })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 0 });
    });
  });

  describe("a subscription recorded without its products", () => {
    it("learns them from the prices it bills, not from the prorations of a change", () => {
      const result = referredInvoiceBase(
        invoice({ total: 8000, total_excluding_tax: 8000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: -2000, proration: true, product: "prod_old" })],
        SUB,
        []
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 8000,
        referredChargeMinor: 8000,
        productIds: [PRODUCT_ID],
        otherProductIds: ["prod_old"],
      });
    });

    it("learns nothing from an invoice of prorations only", () => {
      const result = referredInvoiceBase(
        invoice({ total: 3000, total_excluding_tax: 3000 }),
        [invoiceLine({ amount: 3000, proration: true })],
        SUB,
        []
      );
      expect(result.kind).toBe("unreadable");
    });

    it("never widens to a line on another subscription just because the list is empty", () => {
      const result = referredInvoiceBase(
        invoice({ total: 15000, total_excluding_tax: 15000 }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 5000, subscription: "sub_other", product: "prod_widen" })],
        SUB,
        []
      );
      expect(result).toEqual({
        kind: "earned",
        baseMinor: 10000,
        referredChargeMinor: 10000,
        productIds: [PRODUCT_ID],
        otherProductIds: [],
      });
    });
  });

  describe("referredChargeMinor", () => {
    it("reads it from each counted line's own tax, not spread evenly, when an untaxed referred line sits next to a taxed add-on", () => {
      // 100.00 referred, untaxed; 100.00 add-on with 20.00 of exclusive tax
      // on top; 220.00 charged. Spread evenly the 20.00 would land 10.00 on
      // each line, storing 110.00; only the referred line's own tax (none)
      // is correct here.
      const result = referredInvoiceBase(
        invoice({
          total: 22000,
          total_excluding_tax: 20000,
          total_taxes: [{ amount: 2000, tax_behavior: "exclusive" }],
        }),
        [invoiceLine({ amount: 10000 }), invoiceLine({ amount: 10000, exclusiveTax: 2000, product: "prod_addon" })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 10000, referredChargeMinor: 10000 });
    });

    it("falls back to spreading the invoice's tax evenly, rounded down, when a line's own tax cannot be read", () => {
      // Same 100.00 referred (untaxed) next to a 100.00 add-on with 20.00 of
      // exclusive tax as the accurate case above, but the referred line's own
      // taxes field is neither an array nor null, a shape this module does
      // not expect. Rather than fail the whole invoice, the charge-unit share
      // falls back to spreading the invoice's tax evenly instead of reading
      // each line's own: 100.00 grossed up by 220.00/200.00 lands on 110.00,
      // not the 100.00 the accurate reading would give.
      const unreadableTaxes = {
        ...invoiceLine({ amount: 10000 }),
        taxes: undefined,
      } as unknown as Stripe.InvoiceLineItem;
      const result = referredInvoiceBase(
        invoice({
          total: 22000,
          total_excluding_tax: 20000,
          total_taxes: [{ amount: 2000, tax_behavior: "exclusive" }],
        }),
        [unreadableTaxes, invoiceLine({ amount: 10000, exclusiveTax: 2000, product: "prod_addon" })],
        SUB,
        REFERRED
      );
      expect(result).toMatchObject({ kind: "earned", baseMinor: 10000, referredChargeMinor: 11000 });
    });
  });

  describe("lines it cannot read", () => {
    it.each([
      ["no parent", invoiceLine({ amount: 10000, source: "none" })],
      ["a parent type it does not know", invoiceLine({ amount: 10000, source: "unknown" })],
      ["no product on a subscription line", invoiceLine({ amount: 10000, product: null })],
    ])("earns nothing on a line with %s", (_label, line) => {
      const result = referredInvoiceBase(invoice({}), [line], SUB, REFERRED);
      expect(result.kind).toBe("unreadable");
      if (result.kind === "unreadable") {
        expect(result.reason).not.toContain("\n");
        expect(result.reason).toContain(line.id);
      }
    });

    it("earns nothing when the lines do not add up to the invoice, as when some are missing", () => {
      const result = referredInvoiceBase(
        invoice({ total: 15000, total_excluding_tax: 15000 }),
        [invoiceLine({ amount: 10000 })],
        SUB,
        REFERRED
      );
      expect(result.kind).toBe("unreadable");
    });
  });
});

describe("listInvoiceLines", () => {
  it("reads every page of an invoice's lines through the pinned client", async () => {
    const first = invoiceLine({ id: "il_a", amount: 1 });
    const second = invoiceLine({ id: "il_b", amount: 2 });
    const listLineItems = vi.fn(async (_id: string, params: { starting_after?: string }) =>
      params.starting_after === "il_a" ? { data: [second], has_more: false } : { data: [first], has_more: true }
    );
    const stripe = { invoices: { listLineItems } } as unknown as Stripe;

    expect((await listInvoiceLines(stripe, "in_1")).map((line) => line.id)).toEqual(["il_a", "il_b"]);
    expect(listLineItems).toHaveBeenNthCalledWith(1, "in_1", { limit: 100 });
    expect(listLineItems).toHaveBeenNthCalledWith(2, "in_1", { limit: 100, starting_after: "il_a" });
  });

  it("throws on an empty page that still claims more, rather than reading a short list as complete", async () => {
    // Reconciliation against the invoice's total does not catch every short
    // list: a missing referred proration and a missing one-off item can net
    // to zero and still add up, which would silently overpay the affiliate.
    const listLineItems = vi.fn(async () => ({ data: [], has_more: true }));
    const stripe = { invoices: { listLineItems } } as unknown as Stripe;

    await expect(listInvoiceLines(stripe, "in_1")).rejects.toThrow();
    expect(listLineItems).toHaveBeenCalledTimes(1);
  });

  it("throws when a page read fails, rather than earning on a partial list", async () => {
    const listLineItems = vi.fn(async () => {
      throw new Error("stripe unavailable");
    });
    const stripe = { invoices: { listLineItems } } as unknown as Stripe;

    await expect(listInvoiceLines(stripe, "in_1")).rejects.toThrow("stripe unavailable");
  });
});
