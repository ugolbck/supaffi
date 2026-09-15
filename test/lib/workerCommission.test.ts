import { describe, it, expect, vi } from "vitest";
import { inspect } from "node:util";
import type { Program } from "@prisma/client";
import type Stripe from "stripe";
import {
  addMonthsClamped,
  computeCommissionAmount,
  isExcluded,
  isPaymentWithinCommissionDuration,
  saleAmountFor,
} from "@/lib/worker/commission";

function programOf(type: Program["commissionDurationType"], months: number | null = null): Program {
  return { commissionDurationType: type, commissionDurationMonths: months } as Program;
}

const at = (iso: string) => new Date(iso);

describe("computeCommissionAmount", () => {
  it("rounds a half cent up, where float arithmetic lands just under it", () => {
    // 50% of 2.01 is 1.005 exactly, which floats hold as 1.00499999...
    expect(computeCommissionAmount(201, "usd", 50).toFixed(2)).toBe("1.01");
  });

  it("works in major units for zero-decimal currencies", () => {
    expect(computeCommissionAmount(4900, "jpy", 15).toFixed(2)).toBe("735.00");
  });
});

describe("saleAmountFor", () => {
  it("converts minor units to major", () => {
    expect(saleAmountFor(4900, "usd")).toBe(49);
    expect(saleAmountFor(4999, "eur")).toBe(49.99);
  });

  it("leaves zero-decimal currencies alone", () => {
    expect(saleAmountFor(4900, "jpy")).toBe(4900);
  });
});

describe("addMonthsClamped", () => {
  it("keeps the day and time", () => {
    expect(addMonthsClamped(at("2026-01-15T10:30:00Z"), 2).toISOString()).toBe("2026-03-15T10:30:00.000Z");
  });

  it("stops at the last day of a shorter month instead of spilling into the next", () => {
    // setMonth turned January 31 plus one month into March 3.
    expect(addMonthsClamped(at("2026-01-31T00:00:00Z"), 1).toISOString()).toBe("2026-02-28T00:00:00.000Z");
    expect(addMonthsClamped(at("2028-01-31T00:00:00Z"), 1).toISOString()).toBe("2028-02-29T00:00:00.000Z");
  });

  it("crosses into the next year", () => {
    expect(addMonthsClamped(at("2026-11-30T00:00:00Z"), 3).toISOString()).toBe("2027-02-28T00:00:00.000Z");
  });
});

describe("isPaymentWithinCommissionDuration", () => {
  const first = { ref: "in_first", at: at("2026-01-31T00:00:00Z") };

  it("always counts the first payment itself, whatever the program", () => {
    for (const type of ["ONE_TIME", "FIXED_MONTHS", "FOREVER"] as const) {
      expect(isPaymentWithinCommissionDuration(programOf(type, 1), first, first)).toBe(true);
    }
  });

  it("pays a one-time program on nothing but the first payment", () => {
    const renewal = { ref: "in_2", at: at("2026-02-28T00:00:00Z") };
    expect(isPaymentWithinCommissionDuration(programOf("ONE_TIME"), first, renewal)).toBe(false);
  });

  it("pays a forever program years later", () => {
    const renewal = { ref: "in_60", at: at("2031-01-31T00:00:00Z") };
    expect(isPaymentWithinCommissionDuration(programOf("FOREVER"), first, renewal)).toBe(true);
  });

  it("pays three monthly payments on a three month program started on the 31st, and not a fourth", () => {
    const program = programOf("FIXED_MONTHS", 3);
    expect(isPaymentWithinCommissionDuration(program, first, { ref: "in_2", at: at("2026-02-28T00:00:00Z") })).toBe(true);
    expect(isPaymentWithinCommissionDuration(program, first, { ref: "in_3", at: at("2026-03-31T00:00:00Z") })).toBe(true);
    expect(isPaymentWithinCommissionDuration(program, first, { ref: "in_4", at: at("2026-04-30T00:00:00Z") })).toBe(false);
    // Stripe can create a renewal invoice a little after the period starts.
    expect(isPaymentWithinCommissionDuration(program, first, { ref: "in_4", at: at("2026-04-30T01:00:00Z") })).toBe(false);
  });

  it("does not let a renewal a few minutes early on the boundary count as an extra month", () => {
    const program = programOf("FIXED_MONTHS", 1);
    const late = { ref: "in_first", at: at("2026-03-01T00:05:00Z") };
    expect(isPaymentWithinCommissionDuration(program, late, { ref: "in_2", at: at("2026-04-01T00:00:00Z") })).toBe(false);
  });
});

describe("isExcluded", () => {
  const FLAG = { supaffi: "false" };

  // Answers the three reads the check can make, each clear unless a case says
  // otherwise, and fails one of them the way an outage does.
  function stripeStub(
    opts: {
      invoice?: Record<string, unknown>;
      subscription?: Record<string, unknown>;
      customer?: Record<string, unknown>;
      failing?: "invoice" | "subscription" | "customer";
    } = {}
  ) {
    // A permission error's raw message names the masked key and the account;
    // it must never reach the thrown message, `cause`, or the log.
    const unavailable = () =>
      Object.assign(new Error("The provided key does not have the required permissions on account acct_secret123"), {
        type: "StripePermissionError",
        code: "permission_error",
      });
    const stub = {
      invoices: {
        retrieve: vi.fn(async (id: string): Promise<unknown> => {
          if (opts.failing === "invoice") throw unavailable();
          return { id, metadata: {}, ...opts.invoice };
        }),
      },
      subscriptions: {
        retrieve: vi.fn(async (id: string): Promise<unknown> => {
          if (opts.failing === "subscription") throw unavailable();
          return { id, metadata: {}, ...opts.subscription };
        }),
      },
      customers: {
        retrieve: vi.fn(async (id: string): Promise<unknown> => {
          if (opts.failing === "customer") throw unavailable();
          return { id, metadata: {}, ...opts.customer };
        }),
      },
    };
    return { stub, stripe: stub as unknown as Stripe };
  }

  it("checks objects the caller already holds without asking Stripe anything", async () => {
    const { stub, stripe } = stripeStub();

    await expect(
      isExcluded(
        stripe,
        {
          invoice: { id: "in_1", metadata: {} },
          subscription: { id: "sub_1", metadata: FLAG },
          customer: { id: "cus_1", metadata: {} } as unknown as Stripe.Customer,
        },
        "in_1"
      )
    ).resolves.toBe(true);
    expect(stub.invoices.retrieve).not.toHaveBeenCalled();
    expect(stub.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stub.customers.retrieve).not.toHaveBeenCalled();
  });

  it("stops at the first flag it finds", async () => {
    const { stub, stripe } = stripeStub({ subscription: { metadata: FLAG } });

    await expect(
      isExcluded(stripe, { invoice: { id: "in_1", metadata: FLAG }, subscription: "sub_1", customer: "cus_1" }, "in_1")
    ).resolves.toBe(true);
    expect(stub.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stub.customers.retrieve).not.toHaveBeenCalled();
  });

  it.each([
    ["invoice", { invoice: { metadata: { supaffi: "false" } } }],
    ["subscription", { subscription: { metadata: { supaffi: "false" } } }],
    ["customer", { customer: { metadata: { supaffi: "false" } } }],
  ] as const)("reads the %s by id and excludes on its flag", async (_what, flagged) => {
    const { stripe } = stripeStub(flagged);

    await expect(isExcluded(stripe, { invoice: "in_1", subscription: "sub_1", customer: "cus_1" }, "in_1")).resolves.toBe(true);
  });

  it("excludes a sale whose customer was deleted, since the flag can no longer be read, and names the sale, never the customer", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { stripe } = stripeStub({ customer: { deleted: true, metadata: undefined } });

    await expect(isExcluded(stripe, { customer: "cus_1" }, "in_1")).resolves.toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toMatch(/in_1/);
    expect(warn.mock.calls[0][0]).not.toMatch(/cus_1/);

    warn.mockRestore();
  });

  it("does not exclude a sale nothing marks, and reads nothing it was not given", async () => {
    const { stub, stripe } = stripeStub();

    await expect(isExcluded(stripe, { customer: "cus_1" }, "in_1")).resolves.toBe(false);
    expect(stub.invoices.retrieve).not.toHaveBeenCalled();
    expect(stub.subscriptions.retrieve).not.toHaveBeenCalled();
    expect(stub.customers.retrieve).toHaveBeenCalledWith("cus_1");
  });

  it.each(["invoice", "subscription", "customer"] as const)(
    "throws, rather than answering not excluded, when the %s cannot be read",
    async (failing) => {
      const { stripe } = stripeStub({ failing });

      await expect(
        isExcluded(stripe, { invoice: "in_1", subscription: "sub_1", customer: "cus_1" }, "in_1")
      ).rejects.toThrow(new RegExp(`${failing} .*will be retried`));
    }
  );

  it.each(["invoice", "subscription", "customer"] as const)(
    "carries only the Stripe error's type and code when the %s cannot be read, never the raw message, a cause, or a customer id",
    async (failing) => {
      const { stripe } = stripeStub({ failing });

      let thrown: Error | undefined;
      try {
        await isExcluded(stripe, { invoice: "in_1", subscription: "sub_1", customer: "cus_customer_secret" }, "in_1");
      } catch (err) {
        thrown = err as Error;
      }
      expect(thrown?.message).toMatch(/StripePermissionError\/permission_error/);
      expect(thrown?.message).not.toMatch(/acct_secret123|required permissions/);
      expect(thrown?.message).not.toMatch(/cus_customer_secret/);
      expect(thrown?.cause).toBeUndefined();
      expect(inspect(thrown)).not.toContain("acct_secret123");
      expect(inspect(thrown)).not.toContain("required permissions");
      expect(inspect(thrown)).not.toContain("cus_customer_secret");
    }
  );
});
