import { db } from "@/lib/db";
import { getIntegrationStatus } from "@/lib/merchant";
import { getTrackingStatus, type TrackingStatus } from "@/lib/tracking";
import { deliveryMode } from "@/lib/email/transport";

/**
 * Setup state for one product.
 *
 * Three steps, and they are the three things that have to be true before the
 * product can earn anybody anything: the tools are connected, the terms exist,
 * and the tracking is on the Owner's site.
 *
 * Recruiting an affiliate used to be a fourth step. It is not setup, it is
 * using the product, and counting it meant a fully working product read "3 of
 * 4" forever and kept an onboarding rail on screens that had stopped being
 * onboarding. It lives on as the empty state of the Affiliates screen.
 *
 * Adding the first product is the only step that belongs to the account rather
 * than to a product, so it is not here either: it happens on the dashboard
 * home, and everything after it happens on the product's own page.
 *
 * Both the home page's product list and the product page read this, so the two
 * screens cannot disagree about how far along a product is.
 */
export type ProductSetup = {
  stripeConnected: boolean;
  /** The Stripe secret key is on file, whether or not the webhook secret is. */
  stripeKeyStored: boolean;
  /** The Stripe webhook signing secret is on file, whether or not the key is. */
  stripeWebhookStored: boolean;
  /** A real email provider is on file. False in console mode, where none is needed. */
  emailConnected: boolean;
  /**
   * Whether an email provider has to be connected at all. False when the
   * instance prints emails to the terminal, which is the only way to run
   * locally: mail is sent from the Merchant's own domain, and nobody can
   * verify `localhost:3600` as a sender.
   */
  emailRequired: boolean;
  /** Everything the instance actually needs. Email drops out in console mode. */
  integrationsConnected: boolean;
  firstProgramSlug: string | null;
  trackingStatus: TrackingStatus;
  /** Not a setup step. Cards read it; `doneCount` does not. */
  affiliateCount: number;
  /** Steps finished, out of `totalSteps`. */
  doneCount: number;
  totalSteps: number;
  /** Every step done. Setup is over and the step rail comes off every screen. */
  complete: boolean;
};

export const SETUP_STEP_COUNT = 3;

export async function getProductSetup(
  ownerId: string,
  merchantId: string
): Promise<ProductSetup> {
  const [integrations, program, trackingStatus, affiliateCount] = await Promise.all([
    getIntegrationStatus(ownerId, merchantId),
    db.program.findFirst({
      where: { merchantId },
      orderBy: { createdAt: "asc" },
      select: { slug: true },
    }),
    getTrackingStatus(merchantId),
    db.affiliate.count({ where: { merchantId } }),
  ]);

  // Both integrations, not either. Ticking this off on Stripe alone would
  // leave the Owner one silent failure away from affiliates being unable to
  // log in at all.
  //
  // Unless the instance prints emails instead of sending them, in which case
  // there is nothing to connect and blocking on it would make local setup
  // impossible to finish.
  const emailRequired = deliveryMode() === "send";
  const integrationsConnected = integrations.stripe && (integrations.email || !emailRequired);

  // Tracking counts as done once anything has been recorded, not once a sale
  // has proven the checkout half. Waiting on a stranger to buy something is not
  // a task, and holding setup open on it left every Owner permanently
  // unfinished through no fault of their own.
  const doneCount = [
    integrationsConnected,
    program !== null,
    trackingStatus !== "not-started",
  ].filter(Boolean).length;

  return {
    stripeConnected: integrations.stripe,
    stripeKeyStored: integrations.stripeKey,
    stripeWebhookStored: integrations.stripeWebhook,
    emailConnected: integrations.email,
    emailRequired,
    integrationsConnected,
    firstProgramSlug: program?.slug ?? null,
    trackingStatus,
    affiliateCount,
    doneCount,
    totalSteps: SETUP_STEP_COUNT,
    complete: doneCount === SETUP_STEP_COUNT,
  };
}

