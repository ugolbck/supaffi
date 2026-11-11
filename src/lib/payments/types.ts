import type { Merchant, PaymentProvider } from "@prisma/client";
import type { CheckResult } from "@/lib/checks/dns";
import type { CouponList } from "@/lib/coupon";

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

  /** One call with a key the owner pasted, before it is stored, to say whether it works. */
  checkKey(key: string): Promise<CheckResult>;

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

  /** Promo codes, for a provider whose discounts can carry one per affiliate. */
  promoCodes?: PromoCodeAdapter;
};

/** What a promo code call needs of the product: its credentials. */
export type PromoMerchant = { paymentKeyEnc: string | null; paymentSandbox: boolean };

/**
 * A failure says, in the provider's words, what went wrong.
 * `keyLacksPermission` sends the Owner to replace the key, from the form.
 */
export type PromoFailure = { ok: false; error: string; keyLacksPermission?: true };

/**
 * The provider's side of promo codes. A program picks one of the provider's
 * discounts; each affiliate's code is created from it, named by them; an
 * Owner can also link a code that already exists in the provider. Which code a
 * sale used arrives on the sale itself, so matching it is the adapter's
 * event handling, not part of this.
 */
export type PromoCodeAdapter = {
  /** The discounts that can still be applied, for a program's form. */
  listDiscounts(merchant: PromoMerchant): Promise<CouponList>;
  /** One discount by id, for saving a program: still usable, and its label as of now. */
  discountById(merchant: PromoMerchant, discountRef: string): Promise<{ ok: true; label: string } | PromoFailure>;
  /** The one active code with this text, to link to an affiliate. */
  findCode(merchant: PromoMerchant, code: string): Promise<{ ok: true; ref: string; code: string } | PromoFailure>;
  /** Creates a code from the program's discount. `attempt` makes a retry of the same claim a no-op. */
  createCode(
    merchant: PromoMerchant,
    input: { discountRef: string; code: string; affiliateId: string; attempt: number }
  ): Promise<{ ok: true; ref: string; code: string } | PromoFailure>;
  /** Stops a code Supaffi created from being used at checkout. */
  deactivateCode(merchant: PromoMerchant, ref: string): Promise<{ ok: true } | PromoFailure>;
};

export type VerifiedWebhook = {
  /** The provider's id for the event, which dedupes redeliveries per product. */
  eventId: string;
  /** Stored as the event's payload and handed back to processEvent. */
  payload: unknown;
};

export type WebhookMove = "moved" | "manual" | "none";
