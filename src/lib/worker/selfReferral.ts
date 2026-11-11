import type { Affiliate } from "@prisma/client";

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

// Cheap vector, always on: both checkout.session.completed and invoice.paid
// carry the buyer's email inline in the payload already, no extra API call.
export function checkSelfReferralEmail(affiliate: Affiliate, buyerEmail: string | null): string | null {
  if (buyerEmail && normalize(buyerEmail) === normalize(affiliate.email)) {
    return `email:${buyerEmail.trim()} ${affiliate.email.trim()}`;
  }
  return null;
}
