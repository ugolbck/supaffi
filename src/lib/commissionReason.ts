/**
 * The one place that turns a stored voidReason / flagReason into words. Both
 * fields are internal tokens written by the worker and by owner actions;
 * nothing else should print them raw. Unrecognised input returns null so the
 * caller can show the row with no claim attached rather than a raw token.
 */

export type Audience = "owner" | "affiliate";

const DEFAULT_OWNER_VOID = "voided by owner";

export function voidReasonText(reason: string | null, audience: Audience): string | null {
  if (!reason) return null;

  switch (reason) {
    case "refund":
      return audience === "affiliate" ? "The customer was refunded" : "Refunded in Stripe";
    case "partial refund":
      return audience === "affiliate"
        ? "Reduced because part of the sale was refunded"
        : "Reduced, part of the sale was refunded";
    case "confirmed self-referral":
      return audience === "affiliate"
        ? "This sale was made by you, so it does not earn a commission"
        : "Confirmed self-referral";
    case DEFAULT_OWNER_VOID:
      return audience === "affiliate" ? "Removed by the merchant" : "Voided by you";
    default:
      // A free-text reason the owner typed on the void form: private to
      // them, so the affiliate gets the generic line and the owner sees
      // their own note verbatim.
      return audience === "affiliate" ? "Removed by the merchant" : reason;
  }
}

export function flagReasonText(reason: string | null): { title: string; evidence: string[] } | null {
  if (!reason) return null;

  if (reason === "card") {
    return { title: "The buyer paid with a card the affiliate has used", evidence: [] };
  }

  if (reason.startsWith("email:")) {
    const [buyer, affiliate] = reason.slice("email:".length).split("=");
    if (buyer && affiliate) {
      return {
        title: "The buyer used the affiliate's own email address",
        evidence: [`Buyer ${buyer}`, `Affiliate ${affiliate}`],
      };
    }
  }

  return null;
}
