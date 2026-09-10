import { describe, it, expect } from "vitest";
import { voidReasonText, flagReasonText } from "@/lib/commissionReason";

describe("voidReasonText", () => {
  it("tells an affiliate what happened, in their terms", () => {
    expect(voidReasonText("refund", "affiliate")).toBe("The customer was refunded");
  });

  it("tells the owner what happened, in Stripe's terms", () => {
    expect(voidReasonText("refund", "owner")).toBe("Refunded in Stripe");
  });

  it("distinguishes a partial refund for the affiliate", () => {
    expect(voidReasonText("partial refund", "affiliate")).toBe(
      "Reduced because part of the sale was refunded"
    );
  });

  it("distinguishes a partial refund for the owner", () => {
    expect(voidReasonText("partial refund", "owner")).toBe(
      "Reduced, part of the sale was refunded"
    );
  });

  it("does not leave a confirmed self-referral sounding like an accident, for the affiliate", () => {
    expect(voidReasonText("confirmed self-referral", "affiliate")).toBe(
      "This sale was made by you, so it does not earn a commission"
    );
  });

  it("names a confirmed self-referral plainly for the owner", () => {
    expect(voidReasonText("confirmed self-referral", "owner")).toBe("Confirmed self-referral");
  });

  it("does not print an owner's private note to the affiliate", () => {
    expect(voidReasonText("some private note only the owner should see", "affiliate")).toBe(
      "Removed by the merchant"
    );
  });

  it("shows the owner their own free-text reason verbatim", () => {
    expect(voidReasonText("some private note only the owner should see", "owner")).toBe(
      "some private note only the owner should see"
    );
  });

  it("gives the affiliate a plain explanation for the default owner void", () => {
    expect(voidReasonText("voided by owner", "affiliate")).toBe("Removed by the merchant");
  });

  it("gives the owner a plain label for the default owner void", () => {
    expect(voidReasonText("voided by owner", "owner")).toBe("Voided by you");
  });

  it("returns null for a null reason", () => {
    expect(voidReasonText(null, "affiliate")).toBeNull();
    expect(voidReasonText(null, "owner")).toBeNull();
  });

  it("returns null for an empty reason", () => {
    expect(voidReasonText("", "affiliate")).toBeNull();
    expect(voidReasonText("", "owner")).toBeNull();
  });
});

describe("flagReasonText", () => {
  it("puts the two addresses side by side", () => {
    expect(flagReasonText("email:sarah@x.com=sarah@x.com")).toEqual({
      title: "The buyer used the affiliate's own email address",
      evidence: ["Buyer sarah@x.com", "Affiliate sarah@x.com"],
    });
  });

  it("explains a card match without jargon", () => {
    expect(flagReasonText("card")).toEqual({
      title: "The buyer paid with a card the affiliate has used",
      evidence: [],
    });
  });

  it("returns null for a legacy sentence rather than printing it raw", () => {
    expect(flagReasonText("buyer email matches affiliate email")).toBeNull();
    expect(
      flagReasonText("payment method matches a Stripe Customer sharing the affiliate's email")
    ).toBeNull();
  });

  it("returns null for a null reason", () => {
    expect(flagReasonText(null)).toBeNull();
  });
});
