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
export const KEY_PERMISSIONS = [
  {
    token: "rak_customer_read",
    access: "Read",
    row: "Customers",
    why: "matches a sale to the customer who made it",
  },
  {
    token: "rak_invoice_read",
    access: "Read",
    row: "Invoices",
    why: "finds the payment behind a refunded charge, to claw the commission back",
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
