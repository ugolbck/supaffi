// The exact set of Stripe event types src/lib/worker/dispatch.ts's switch
// statement handles. Keep this list and that switch in sync by hand — if
// you add a case there, add it here too, and vice versa. Used to tell a
// Merchant exactly which events to enable on their Stripe webhook endpoint;
// a Merchant enabling fewer than this list means Supaffi silently misses
// real Commissions.
export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  "invoice.paid",
  "charge.refunded",
  "customer.subscription.deleted",
] as const;
