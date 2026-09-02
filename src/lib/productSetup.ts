import { db } from "@/lib/db";
import { getIntegrationStatus } from "@/lib/merchant";
import { getTrackingStatus, type TrackingStatus } from "@/lib/tracking";
import { deliveryMode } from "@/lib/email/transport";

/**
 * Setup state for one product.
 *
 * Adding the first product is the only step that belongs to the account rather
 * than to a product, so it is not here: it happens on the dashboard home, and
 * everything after it happens on the product's own page. That split is what
 * makes a second product work at all, since a wizard living on the home page
 * has no way to say which product it is talking about.
 *
 * Both the home page's product list and the product page read this, so the two
 * screens cannot disagree about how far along a product is.
 */
export type SetupStepId = "integrations" | "program" | "tracking" | "affiliate";

export type ProductSetup = {
  stripeConnected: boolean;
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
  firstProgramId: string | null;
  trackingStatus: TrackingStatus;
  affiliateCount: number;
  /** Steps finished, out of `totalSteps`. */
  doneCount: number;
  totalSteps: number;
  /** Every step done, including tracking proven by a real attributed sale. */
  complete: boolean;
};

export const SETUP_STEP_COUNT = 4;

export async function getProductSetup(
  ownerId: string,
  merchantId: string
): Promise<ProductSetup> {
  const [integrations, program, trackingStatus, affiliateCount] = await Promise.all([
    getIntegrationStatus(ownerId, merchantId),
    db.program.findFirst({
      where: { merchantId },
      orderBy: { createdAt: "asc" },
      select: { id: true },
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

  // Tracking only counts once a real sale has arrived carrying a token. That
  // is the single moment both halves of the integration are proven, so it is
  // what 100% has to mean.
  //
  // `awaiting-sale` is deliberately not counted here. It gets its own state in
  // the checklist instead, so the row reads as in progress rather than
  // untouched, without inflating the number.
  const doneCount = [
    integrationsConnected,
    program !== null,
    trackingStatus === "verified",
    affiliateCount > 0,
  ].filter(Boolean).length;

  return {
    stripeConnected: integrations.stripe,
    emailConnected: integrations.email,
    emailRequired,
    integrationsConnected,
    firstProgramId: program?.id ?? null,
    trackingStatus,
    affiliateCount,
    doneCount,
    totalSteps: SETUP_STEP_COUNT,
    complete: doneCount === SETUP_STEP_COUNT,
  };
}

/**
 * The four steps in order, each knowing where it lives and whether it is done.
 *
 * One list, so the checklist on the product page, the "Step N of 4" on each
 * setup screen and the forward button in their footers can never disagree
 * about what the sequence is.
 */
export function setupSteps(
  merchantId: string,
  setup: ProductSetup
): { id: SetupStepId; index: number; label: string; href: string; done: boolean }[] {
  const base = `/dashboard/products/${merchantId}`;
  return [
    {
      id: "integrations",
      index: 1,
      label: "Connect your tools",
      href: `${base}/integrations`,
      done: setup.integrationsConnected,
    },
    {
      id: "program",
      index: 2,
      label: "Set your commission terms",
      href: `${base}/programs/new`,
      done: setup.firstProgramId !== null,
    },
    {
      id: "tracking",
      index: 3,
      label: "Install tracking",
      href: `${base}/tracking`,
      // Counts as handled once clicks arrive: waiting on a customer to buy is
      // not something the Owner can act on, so it never blocks the way forward.
      done: setup.trackingStatus !== "not-started",
    },
    {
      id: "affiliate",
      index: 4,
      label: "Recruit your first affiliate",
      href: base,
      done: setup.affiliateCount > 0,
    },
  ];
}

/**
 * Where a given step leads.
 *
 * Strictly forward, never back to itself. A screen whose own step is the
 * outstanding one would otherwise offer no way on at all, which is exactly the
 * dead end that makes an Owner bounce off to the product page and lose the
 * thread of setup.
 */
export function stepAfter(
  merchantId: string,
  setup: ProductSetup,
  index: number
): { label: string; href: string } | null {
  const steps = setupSteps(merchantId, setup);
  return steps.find((step) => step.index > index && !step.done) ?? null;
}
