import type { Merchant, PaymentProvider } from "@prisma/client";

/**
 * What one payment provider plugs into Supaffi.
 *
 * Everything that knows a provider's API, payload shapes or ids lives behind
 * this, in src/lib/payments/<provider>/. The commission engine in
 * src/lib/worker/ never imports a provider (eslint enforces it): an adapter
 * reads its own events and calls the engine's steps, the same ones for every
 * provider (attribution, the referral's duration, the commission write,
 * reversal, dispute holds, the end of a subscription).
 *
 * A product takes its payments through exactly one provider, stored on
 * Merchant.paymentProvider, and its key, webhook secret and every stored
 * payment reference belong to that provider.
 */
export type PaymentProviderAdapter = {
  id: PaymentProvider;
  /** As the owner reads it: "Stripe". */
  name: string;
  /** The last segment of the webhook address, /api/webhooks/<slug>. Never changes once shipped: live endpoints point at it. */
  webhookSlug: string;

  /** The header a delivery's signature arrives in. A request without it is turned away before any lookup. */
  signatureHeader: string;

  /**
   * Checks a delivery's signature against the product's signing secret.
   * Returns the event to queue, or null when it does not verify.
   */
  verifyWebhook(input: { rawBody: string; headers: Headers; secret: string }): VerifiedWebhook | null;

  /**
   * Processes one queued event: reads what it needs from the payload and the
   * provider's API, then calls the engine. Event types the adapter does not
   * handle return without doing anything. Throws to have the event retried.
   */
  processEvent(merchant: Merchant, payload: unknown): Promise<void>;

  /** The event types processEvent handles, which the product's webhook must be subscribed to. */
  handledEvents: readonly string[];

  /**
   * Whether an error came from this provider's API, and its log-safe label.
   * A provider's raw error message can name the account or a masked key, so
   * only the label is ever logged or stored.
   */
  errorLabel(err: unknown): string | null;

  /** A payment reference as a link into the provider's dashboard, when it has one. */
  paymentUrl(paymentRef: string): string | null;

  /** Brings every product's webhook up to the handled events, once per start. Never throws. */
  upgradeWebhookEndpoints?(): Promise<void>;

  /**
   * Points the product's webhook at its domain after the domain changed.
   * Never throws. "manual" means the provider still delivers to the old
   * address and only the owner can change that.
   */
  moveWebhookEndpoint?(merchantId: string): Promise<WebhookMove>;
};

export type VerifiedWebhook = {
  /** The provider's id for the event, which dedupes redeliveries per product. */
  eventId: string;
  /** Stored as the event's payload and handed back to processEvent. */
  payload: unknown;
};

export type WebhookMove = "moved" | "manual" | "none";
