// The Stripe event types Supaffi handles. dispatch.ts keys its handlers by
// this list, so the compiler keeps the two in step. Used to tell a Merchant
// exactly which events to enable on their Stripe webhook endpoint, and as the
// enabled events when Supaffi creates the endpoint itself; a Merchant
// enabling fewer than this list means Supaffi silently misses real
// Commissions.
export const REQUIRED_STRIPE_WEBHOOK_EVENTS = [
  "checkout.session.completed",
  // Delayed payment methods (SEPA, ACH, Boleto) complete the Session unpaid
  // and only settle later; this is the event that says the money arrived.
  "checkout.session.async_payment_succeeded",
  "invoice.paid",
  "charge.refunded",
  // An open chargeback holds the commission until it closes.
  "charge.dispute.created",
  // A lost chargeback takes the sale back just like a full refund; any other
  // outcome releases the hold.
  "charge.dispute.closed",
  "customer.subscription.deleted",
] as const;
