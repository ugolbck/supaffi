import type { ProductSetup } from "@/lib/productSetup";
import type { ProductChecks } from "@/lib/checks/product";
import { registrableCandidates } from "@/lib/checks/dns";

export type StepId =
  | "product"
  | "subdomain"
  | "stripe-key"
  | "email"
  | "terms"
  | "tracking";

/**
 * "waiting" is not "unfinished": the row is reached, its section was re-run
 * this request, and the check said no. Everything else is done, current or
 * upcoming.
 */
export type StepState = "done" | "waiting" | "current" | "upcoming";
export type Step = {
  id: StepId;
  label: string;
  index: number;
  state: StepState;
};

const ALL: StepId[] = [
  "product",
  "subdomain",
  // No webhook step. The key is made from a link that ticks write access on
  // webhook endpoints, and saving it creates the endpoint in the same
  // action, so there was nothing left for a screen to ask.
  "stripe-key",
  // One step, not two. The domain and the key are both done in Resend, in
  // one sitting, in one browser tab: splitting them meant two screens each
  // carrying their own "Open Resend" button, and a domain screen with
  // nothing to check on it because checking needs the key from the screen
  // after it.
  "email",
  "terms",
  "tracking",
];

const LABELS: Record<StepId, string> = {
  product: "Product",
  subdomain: "Subdomain",
  "stripe-key": "Stripe key",
  email: "Email",
  terms: "Terms",
  tracking: "Tracking",
};

/** The steps in order. The email step exists only when the instance sends real email. */
export function stepIds(emailRequired: boolean): StepId[] {
  return emailRequired ? ALL : ALL.filter((id) => id !== "email");
}

export function stepLabel(id: StepId): string {
  return LABELS[id];
}

/** The step's 1-based position among the steps the instance actually has. */
export function stepIndex(id: StepId, emailRequired: boolean): number {
  return stepIds(emailRequired).indexOf(id) + 1;
}

/**
 * What the counter shows: position and total, over the steps there are.
 *
 * The rail used to open with two rows already ticked, the install and the
 * account. Neither is a screen anyone can go to and neither tells the reader
 * anything they do not know, so all they did was make the flow look two
 * steps longer than it is.
 */
export function displayStep(id: StepId, emailRequired: boolean): { index: number; total: number } {
  return { index: stepIndex(id, emailRequired), total: stepIds(emailRequired).length };
}

/**
 * Which group of checks a step's screen actually shows, or null when it shows
 * none. What the polling on that step has to re-run, and nothing else.
 */
export function checkSectionFor(id: StepId): keyof ProductChecks | null {
  switch (id) {
    case "subdomain":
      return "dns";
    case "stripe-key":
      return "stripe";
    case "email":
      return "email";
    case "tracking":
      return "tracking";
    case "product":
    case "terms":
      return null;
  }
}

export function stepPath(productSlug: string, id: StepId): string {
  return `/onboarding/${productSlug}/${id}`;
}

export function isStepId(value: string): value is StepId {
  return (ALL as string[]).includes(value);
}

/**
 * Whether the step's stored data exists. This is what lets the user move on;
 * it says nothing about whether the outside world has caught up.
 */
function stored(id: StepId, setup: ProductSetup, onboardingCompletedAt: Date | null): boolean {
  switch (id) {
    case "product":
      return true;
    case "subdomain":
      // No field records it directly: its DNS state is a live check, not
      // stored data. So it is inferred from what came after. Anything stored
      // by a later step means the Owner walked past this screen, and nothing
      // stored at all means they never reached it, which is where a resume
      // should put them back.
      return (
        setup.stripeKeyStored ||
        setup.stripeWebhookStored ||
        setup.emailConnected ||
        setup.firstProgramSlug !== null ||
        setup.trackingStatus !== "not-started"
      );
    case "stripe-key":
      return setup.stripeKeyStored;
    case "email":
      return setup.emailConnected;
    case "terms":
      return setup.firstProgramSlug !== null;
    case "tracking":
      return setup.trackingStatus !== "not-started";
  }
}

/** Whether the outside world agrees. Steps with no check are verified once stored. */
function verified(id: StepId, checks: ProductChecks, setup: ProductSetup, onboardingCompletedAt: Date | null): boolean {
  switch (id) {
    case "subdomain":
      return checks.dns.resolves.ok && checks.dns.https.ok && checks.dns.certificate.ok;
    case "stripe-key":
      return checks.stripe.key.ok;
    // Both halves, because both are needed before a single affiliate can log
    // in: a key that works but a domain Resend will not send from delivers
    // nothing.
    case "email":
      return checks.email.key.ok && checks.email.domain.ok;
    case "tracking":
      return checks.tracking.script.ok || setup.trackingStatus !== "not-started";
    default:
      return stored(id, setup, onboardingCompletedAt);
  }
}

export function stepStates(input: {
  setup: ProductSetup;
  checks: ProductChecks;
  onboardingCompletedAt: Date | null;
  current: StepId;
  /**
   * Nothing outside can reach a machine on someone's desk, so the subdomain's
   * checks can never come good there. The rail does not ask them to: it would
   * sit amber for the whole of a developer's run.
   */
  dnsUnavailable?: boolean;
}): Step[] {
  const ids = stepIds(input.setup.emailRequired);
  const currentIndex = ids.indexOf(input.current);
  return ids.map((id, index) => {
    const behind = index < currentIndex;
    const reached = stored(id, input.setup, input.onboardingCompletedAt) || behind;
    const isVerified =
      id === "subdomain" && input.dnsUnavailable
        ? true
        : verified(id, input.checks, input.setup, input.onboardingCompletedAt);
    let state: StepState;
    if (id === input.current) state = "current";
    // A tick means the outside world agreed, and nothing else. Walking past a
    // step used to be enough to paint it green, so a subdomain whose record
    // had been deleted and an email step whose domain was never added both
    // read as finished the moment the Owner pressed Continue. A step that has
    // been reached and is not passing is waiting, wherever the Owner is
    // standing now, and the rail's waiting rows are links back to it.
    else if (isVerified) state = "done";
    else if (reached) state = "waiting";
    else state = "upcoming";
    return { id, label: LABELS[id], index: index + 1, state };
  });
}

export function nextStep(current: StepId, emailRequired: boolean): StepId | null {
  const ids = stepIds(emailRequired);
  const i = ids.indexOf(current);
  return i >= 0 && i < ids.length - 1 ? ids[i + 1] : null;
}

export function previousStep(current: StepId, emailRequired: boolean): StepId | null {
  const ids = stepIds(emailRequired);
  const i = ids.indexOf(current);
  return i > 0 ? ids[i - 1] : null;
}

/**
 * The subdomain to propose from the website address: go. on the site's own
 * domain, www dropped.
 *
 * Not affiliates. Every affiliate link carries this host, so short wins, and
 * the login emails go out from affiliates@ this domain, which under
 * affiliates.acme.com read as affiliates@affiliates.acme.com.
 */
export function suggestSubdomain(websiteUrl: string): string {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return host ? `go.${host}` : "";
  } catch {
    return "";
  }
}

/**
 * The editable label and the fixed tail of a product's address.
 *
 * The root belongs to the product's own website and is set on the product
 * step, so the subdomain step only ever lets someone change the label in
 * front of it. Retyping the root here would let the program's address drift
 * away from the site it sends people to.
 *
 * Null when the stored address is not a subdomain of the product's site at
 * all, which is the case on a local instance and for anything set by hand
 * before this rule existed. Those are edited whole.
 */
export function splitSubdomain(domain: string, websiteUrl: string): { prefix: string; suffix: string } | null {
  const root = siteHost(websiteUrl).replace(/^www\./, "");
  if (!root || !domain.endsWith(`.${root}`)) return null;
  const prefix = domain.slice(0, -(root.length + 1));
  return prefix ? { prefix, suffix: `.${root}` } : null;
}

// Second-level labels that are commonly used as a suffix under a two-letter
// country code (co.uk, com.au, ...). Not a suffix list: just enough to keep
// the go.example.co.uk case out of registrableCandidates' two-label guess.
const COMMON_SECOND_LEVEL_SUFFIXES = new Set(["co", "com", "org", "net", "ac", "gov", "edu"]);

/**
 * The record name Cloudflare wants, relative to the zone it will host the
 * record in. The subdomain step only shows the editable prefix, which is the
 * whole story on a bare domain but not when the product's website is itself
 * a subdomain (dev.mokkit.co): the zone there is mokkit.co, so the record
 * for affiliates.dev.mokkit.co is affiliates.dev, not affiliates.
 */
export function dnsRecordName(domain: string): string {
  const [twoLabel, threeLabel] = registrableCandidates(domain);
  const [first, second] = twoLabel.split(".");
  const looksLikeCoUk = Boolean(second) && COMMON_SECOND_LEVEL_SUFFIXES.has(first) && /^[a-z]{2}$/i.test(second);
  const zone = looksLikeCoUk ? threeLabel : twoLabel;
  if (domain === zone || !domain.endsWith(`.${zone}`)) return domain;
  return domain.slice(0, -(zone.length + 1));
}

/**
 * The address to keep when the product's website changes.
 *
 * Someone who fixed a wrong website URL should not silently lose a subdomain
 * label they chose, so the label is carried across onto the new root. Only
 * when there was no label to carry does this fall back to the default.
 */
export function rehomeSubdomain(currentDomain: string, previousWebsiteUrl: string, nextWebsiteUrl: string): string {
  const suggestion = suggestSubdomain(nextWebsiteUrl);
  if (!suggestion) return currentDomain;
  const split = splitSubdomain(currentDomain, previousWebsiteUrl);
  if (!split) return suggestion;
  const nextRoot = siteHost(nextWebsiteUrl).replace(/^www\./, "");
  return `${split.prefix}.${nextRoot}`;
}

/**
 * The site's hostname for showing in a sentence. The raw value when it cannot
 * be parsed: a screen that says the address back is more use than one that
 * throws on a Merchant whose website was stored before it was validated.
 */
export function siteHost(websiteUrl: string): string {
  try {
    return new URL(websiteUrl).hostname || websiteUrl;
  } catch {
    return websiteUrl;
  }
}

/**
 * Where the rail's way out leads, or null when there is none.
 *
 * Only a product that finished onboarding has a dashboard worth landing on;
 * offering "Back to dashboard" while every product is half-built drops
 * someone onto screens that can do nothing yet, and the flow they left is
 * the only place that can fix that.
 */
export function backToDashboardHref(
  others: { onboardingCompletedAt: Date | null }[]
): string | null {
  return others.some((m) => m.onboardingCompletedAt !== null) ? "/dashboard" : null;
}

/**
 * Where to drop someone who left partway: the first step whose data is not
 * stored. Null once there is nothing left to set up, which is the caller's
 * cue to send them to the finished screen rather than back into the flow.
 */
export function resumeStep(setup: ProductSetup, onboardingCompletedAt: Date | null): StepId | null {
  const ids = stepIds(setup.emailRequired).filter((id) => id !== "product");
  for (const id of ids) {
    if (!stored(id, setup, onboardingCompletedAt)) return id;
  }
  return null;
}
