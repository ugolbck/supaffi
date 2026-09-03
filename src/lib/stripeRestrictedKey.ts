/**
 * The pre-filled restricted-key link.
 *
 * Stripe's Dashboard accepts a pre-filled key-creation form at
 * `/apikeys/create`, taking a `name` and a repeated `permissions[]`. It is not
 * documented, and its failure mode is silence: an identifier the form does not
 * recognise selects nothing, is not rejected, and is echoed back in the URL
 * unchanged. A typo here produces a link that looks correct, opens a form that
 * looks correct, and yields a key that fails on the first refund.
 *
 * Each token is `rak_` + the permission name from Stripe's Apps permissions
 * reference. That mapping holds for most rows but not all: the row shown as
 * **Financial Reports** is keyed `financial_statement`, not the
 * `report_runs_and_report_types_*` the same reference gives it. So the `row`
 * label below is what has to be read back off the real form, not inferred.
 *
 * Anything changed here gets checked against the real form again: open the
 * link, read the rows, confirm every one is on Read and nothing else is.
 */

export type KeyPermission = {
  /** The `permissions[]` value. */
  token: string;
  /** Stripe's own label for the row, so the owner can check the claim. */
  row: string;
  /** Which Supaffi call needs it. */
  why: string;
};

// `as const satisfies` rather than an annotation: the annotation would freeze
// the array but leave every record writable, and the point of this table is
// that a token cannot be edited casually.
export const KEY_PERMISSIONS = [
  {
    token: "rak_customer_read",
    row: "Customers",
    why: "matches a sale to the customer who made it",
  },
  {
    token: "rak_invoice_read",
    row: "Invoices",
    why: "finds the payment behind a refunded charge, to claw the commission back",
  },
  {
    token: "rak_payment_intent_read",
    row: "Payment Intents",
    why: "reads the payment a commission is owed on",
  },
  {
    token: "rak_payment_method_read",
    row: "Payment Methods",
    why: "spots an affiliate buying through their own link",
  },
  {
    token: "rak_subscription_read",
    row: "Subscriptions",
    why: "tracks renewals for recurring commissions",
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
