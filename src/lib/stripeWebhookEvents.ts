// The exact set of Stripe event types src/lib/worker/dispatch.ts's switch
// statement handles. Keep this list and that switch in sync by hand — if
// you add a case there, add it here too, and vice versa. Used to tell a
// Merchant exactly which events to enable on their Stripe webhook endpoint,
// and as the enabled events when Supaffi creates the endpoint itself;
// a Merchant enabling fewer than this list means Supaffi silently misses
// real Commissions.
export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  // Delayed payment methods (SEPA, ACH, Boleto) complete the Session unpaid
  // and only settle later; this is the event that says the money arrived.
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "charge.refunded",
  // A lost chargeback takes the sale back just like a full refund.
  "charge.dispute.closed",
  "customer.subscription.deleted",
] as const;
