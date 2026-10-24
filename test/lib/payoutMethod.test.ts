import { describe, it, expect } from "vitest";
import { composePayoutDetails, parsePayoutDetails } from "@/lib/payoutMethod";

describe("payout details", () => {
  it("writes a method and value as one line", () => {
    expect(composePayoutDetails("paypal", " a@b.com ")).toBe("PayPal: a@b.com");
    expect(composePayoutDetails("bank", "DE89 3704 0044")).toBe("Bank transfer: DE89 3704 0044");
    expect(composePayoutDetails("other", "Crypto: 0xabc")).toBe("Crypto: 0xabc");
    expect(composePayoutDetails("wise", "  ")).toBe("");
  });

  it("reads a line back into its method and value", () => {
    expect(parsePayoutDetails("PayPal: a@b.com")).toEqual({ method: "paypal", value: "a@b.com" });
    expect(parsePayoutDetails("wise:a@b.com")).toEqual({ method: "wise", value: "a@b.com" });
    expect(parsePayoutDetails("Bank transfer: DE89")).toEqual({ method: "bank", value: "DE89" });
  });

  it("keeps a free-form line whole as other, and starts empty on PayPal", () => {
    expect(parsePayoutDetails("IBAN NL91 ABNA 0417 1643 00")).toEqual({
      method: "other",
      value: "IBAN NL91 ABNA 0417 1643 00",
    });
    expect(parsePayoutDetails(null)).toEqual({ method: "paypal", value: "" });
  });

  it("round-trips every method", () => {
    for (const method of ["paypal", "wise", "bank", "other"] as const) {
      expect(parsePayoutDetails(composePayoutDetails(method, "x@y.z"))).toEqual({ method, value: "x@y.z" });
    }
  });
});
