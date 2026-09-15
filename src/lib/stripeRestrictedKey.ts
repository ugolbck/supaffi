export type KeyPermission = {
  /** Stable identifier for the row. Not sent anywhere. */
  token: string;
  /** Stripe's own label for the row, so the owner can find it on the form. */
  row: string;
  /** The access level to select on that row. */
  access: "Read" | "Write";
  /** Which Supaffi call needs it. */
  why: string;
};

// `as const satisfies` rather than an annotation: the annotation would freeze
// the array but leave every record writable, and the point of this table is
// that a token cannot be edited casually.
// Charges arrived in 0.2.4. Keys made before then lack it, and the one call
// that needs it treats any failure, whatever error Stripe returns for the
// missing permission, as "unknown" and carries on: an owner who has not
// replaced their key loses nothing that Charges already covered. Checkout
// Sessions, below, behaves differently on purpose: a one-time sale cannot be
// judged without it, so a key missing that permission makes every one-time
// sale retry and earn nothing until the key is replaced, rather than
// silently carrying on the way Charges does. Retries last about two days,
// the worker's twenty attempts (claim.ts); after that the event is marked
// FAILED and the sale does not earn.
export const KEY_PERMISSIONS = [
  {
    token: "rak_charge_read",
    access: "Read",
    row: "Charges",
    why: "checks whether a sale was refunded before its commission was recorded",
  },
  // Checkout Sessions arrived in 0.2.7, to read the tax on a one-time sale. A
  // key without it still works for subscriptions; its one-time sales retry
  // and earn nothing until the key is replaced. Retries last about two days,
  // the worker's twenty attempts (claim.ts); after that the event is marked
  // FAILED and the sale does not earn. Stripe's Stripe Apps
  // permissions reference does name the underlying permission: "Checkout
  // Sessions | Checkout Sessions | checkout_session_read,
  // checkout_session_write | ... Read access lets you retrieve session
  // details, line items, and related payment information" (Stripe docs,
  // stripe-apps/reference/permissions.md). What is unconfirmed, as for every
  // row in this table, is only the `rak_` link-form token below: whether an
  // unrecognised one is silently ignored rather than rejected is not
  // documented by Stripe, and is instead a known gap recorded in the project
  // (docs/ROADMAP.md, "Known gaps"), so the owner still has to confirm the
  // Checkout Sessions row is actually selected on the key form the link opens.
  {
    token: "rak_checkout_session_read",
    access: "Read",
    row: "Checkout Sessions",
    why: "reads the tax on a one-time sale, so no commission is earned on it",
  },
  {
    token: "rak_customer_read",
    access: "Read",
    row: "Customers",
    why: "matches a sale to the customer who made it",
  },
  {
    token: "rak_dispute_read",
    access: "Read",
    row: "Disputes",
    why: "holds a commission while its sale is disputed",
  },
  {
    token: "rak_invoice_read",
    access: "Read",
    row: "Invoices",
    why: "finds the payment behind a refunded charge, to lower or cancel its commission",
  },
  {
    token: "rak_payment_intent_read",
    access: "Read",
    row: "Payment Intents",
    why: "reads the payment a commission is owed on",
  },
  {
    token: "rak_payment_method_read",
    access: "Read",
    row: "Payment Methods",
    why: "spots an affiliate buying through their own link",
  },
  {
    token: "rak_subscription_read",
    access: "Read",
    row: "Subscriptions",
    why: "tracks renewals for recurring commissions",
  },
  // The only write in the list, and the reason the webhook step no longer
  // exists: with it Supaffi creates its own endpoint and reads back the
  // signing secret, instead of walking the owner through Stripe's three-step
  // wizard and asking them to copy a secret across by hand.
  {
    token: "rak_webhook_write",
    access: "Write",
    row: "Webhook Endpoints",
    why: "creates the endpoint that tells Supaffi about sales",
  },
] as const satisfies readonly KeyPermission[];

/** What the key is called in Stripe's own list, so several are tellable apart. */
export function keyName(productName?: string): string {
  const product = productName?.trim();
  return product ? `Supaffi: ${product}` : "Supaffi";
}

/**
 * No account id in the path on purpose. Stripe resolves the bare URL against
 * whichever account the browser is in and lets the owner switch with its own
 * picker. Pinning `/acct_.../` would send every click to the same account.
 *
 * `permissions[]` is repeated rather than joined: a comma-joined single value
 * is accepted by the URL and selects nothing.
 */
export function restrictedKeyUrl(productName?: string): string {
  const params = new URLSearchParams();
  params.set("name", keyName(productName));
  const permissions = KEY_PERMISSIONS.map(
    (permission) => `permissions[]=${encodeURIComponent(permission.token)}`
  ).join("&");
  return `https://dashboard.stripe.com/apikeys/create?${params.toString()}&${permissions}`;
}
