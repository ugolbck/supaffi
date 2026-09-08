import { describe, it, expect } from "vitest";
import { stripeKeyWorks } from "@/lib/checks/stripe";

describe("stripeKeyWorks", () => {
  it("passes when one read succeeds", async () => {
    const result = await stripeKeyWorks("rk_test_x", () => ({ customers: { list: async () => ({}) } }));
    expect(result.ok).toBe(true);
  });

  it("names a permissions problem", async () => {
    const result = await stripeKeyWorks("rk_test_x", () => ({
      customers: { list: async () => { throw Object.assign(new Error("no"), { type: "StripePermissionError" }); } },
    }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/permission/i);
  });

  it("names a bad key", async () => {
    const result = await stripeKeyWorks("rk_test_x", () => ({
      customers: { list: async () => { throw Object.assign(new Error("no"), { type: "StripeAuthenticationError" }); } },
    }));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/not valid/i);
  });

  it("refuses a key that is not a Stripe key at all", async () => {
    const result = await stripeKeyWorks("hello", () => ({ customers: { list: async () => ({}) } }));
    expect(result.ok).toBe(false);
  });
});
