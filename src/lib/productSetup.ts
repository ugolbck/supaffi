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
export type SetupStepId = "integrations" | "program" | "tracking";

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

/**
 * The three steps in order, each knowing where it lives and whether it is done.
 *
 * One list, so the stepper on the product page, the "Step N of 3" on each setup
 * screen and the forward button in their footers can never disagree about what
 * the sequence is.
 */
export function setupSteps(
  productSlug: string,
  setup: ProductSetup
): { id: SetupStepId; index: number; label: string; href: string; done: boolean }[] {
  const base = `/dashboard/products/${productSlug}`;
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
      done: setup.firstProgramSlug !== null,
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
  ];
}

export type ProductSection = "programs" | "tracking" | "affiliates" | "commissions";

/**
 * Which product sections can actually do something yet.
 *
 * Overview, Integrations and Settings are always open: they are where an
 * Owner goes to change the very state these gates read. The other four have a
 * prerequisite, and before it is met every control on them is a dead end, so
 * they read as locked in the sidebar and redirect if the URL is typed.
 *
 * One definition, read by the sidebar and by each gated page, so a section can
 * never render while its row says locked, or the other way round.
 */
export function sectionGates(setup: ProductSetup): Record<ProductSection, boolean> {
  return {
    programs: setup.stripeConnected,
    tracking: setup.firstProgramSlug !== null,
    affiliates: setup.firstProgramSlug !== null,
    commissions: setup.trackingStatus !== "not-started",
  };
}

/** The step that unlocks a section, as a path under the product. */
export const SECTION_UNLOCKED_BY: Record<ProductSection, string> = {
  programs: "/integrations",
  tracking: "/programs/new",
  affiliates: "/programs/new",
  commissions: "/tracking",
};

/**
 * Where a given step leads.
 *
 * Strictly forward, never back to itself. A screen whose own step is the
 * outstanding one would otherwise offer no way on at all, which is exactly the
 * dead end that makes an Owner bounce off to the product page and lose the
 * thread of setup.
 */
export function stepAfter(
  productSlug: string,
  setup: ProductSetup,
  index: number
): { label: string; href: string } | null {
  const steps = setupSteps(productSlug, setup);
  return steps.find((step) => step.index > index && !step.done) ?? null;
}
