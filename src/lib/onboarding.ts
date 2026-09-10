import type { ProductSetup } from "@/lib/productSetup";
import type { ProductChecks } from "@/lib/checks/product";
import { registrableCandidates } from "@/lib/checks/dns";

export type StepId =
  | "product"
  | "subdomain"
  | "stripe-key"
  | "stripe-webhook"
  | "email-key"
  | "email-domain"
  | "terms"
  | "tracking";

/**
 * "waiting" is not "unfinished": it is the one row (the Stripe webhook) whose
 * light waits on the outside world rather than on the Owner. Everything else
 * is done, current or upcoming.
 */
export type StepState = "done" | "waiting" | "current" | "upcoming";
export type Step = { id: StepId; label: string; index: number; state: StepState };

const ALL: StepId[] = [
  "product",
  "subdomain",
  "stripe-key",
  "stripe-webhook",
  // The domain has to exist before a key can be scoped to it: Resend's key
  // form asks which domain the key may send from, so asking for the domain
  // first is what makes that question answerable rather than backwards.
  "email-domain",
  "email-key",
  "terms",
  "tracking",
];

const LABELS: Record<StepId, string> = {
  product: "Product",
  subdomain: "Subdomain",
  "stripe-key": "Stripe key",
  "stripe-webhook": "Stripe webhook",
  "email-key": "Email key",
  "email-domain": "Sending domain",
  terms: "Terms",
  tracking: "Tracking",
};

/** The steps in order. The two email steps exist only when the instance sends real email. */
export function stepIds(emailRequired: boolean): StepId[] {
  return emailRequired ? ALL : ALL.filter((id) => !id.startsWith("email-"));
}

export function stepLabel(id: StepId): string {
  return LABELS[id];
}

/** The step's 1-based position among the steps the instance actually has. */
export function stepIndex(id: StepId, emailRequired: boolean): number {
  return stepIds(emailRequired).indexOf(id) + 1;
}

/**
 * The rail opens with two rows already ticked: the install, and the account
 * the setup screen created. They are real work the user did, so the counter
 * counts them. Leaving them out is what made a rail of nine rows sit under
 * the words "step 2 of 7".
 */
export const STEPS_ALREADY_DONE = 2;

/** What the counter shows: position and total, both including the ticked rows. */
export function displayStep(id: StepId, emailRequired: boolean): { index: number; total: number } {
  return {
    index: stepIndex(id, emailRequired) + STEPS_ALREADY_DONE,
    total: stepIds(emailRequired).length + STEPS_ALREADY_DONE,
  };
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
    case "stripe-webhook":
      return "stripe";
    case "email-key":
    case "email-domain":
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
    // The two Stripe halves are stored one at a time, and each step owns its
    // own. Reading both from one flag stranded anyone who had pasted the key
    // but not the signing secret on a step that thought it was finished.
    case "stripe-key":
      return setup.stripeKeyStored;
    case "stripe-webhook":
      return setup.stripeWebhookStored;
    case "email-key":
    case "email-domain":
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
    case "stripe-webhook":
      return checks.stripe.webhook.ok;
    case "email-key":
      return checks.email.key.ok;
    case "email-domain":
      return checks.email.domain.ok;
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
}): Step[] {
  const ids = stepIds(input.setup.emailRequired);
  const currentIndex = ids.indexOf(input.current);
  return ids.map((id, index) => {
    const behind = index < currentIndex;
    const reached = stored(id, input.setup, input.onboardingCompletedAt) || behind;
    let state: StepState;
    if (id === input.current) state = "current";
    // The webhook is the only row whose green light is not the Owner's to
    // earn: it turns when a real sale arrives, which can be days away. Left
    // in the same amber as unfinished work it sat there beside seven green
    // rows reading as a fault, so it gets its own settled, neutral state.
    else if (id === "stripe-webhook") {
      state = verified(id, input.checks, input.setup, input.onboardingCompletedAt)
        ? "done"
        : reached
          ? "waiting"
          : "upcoming";
    }
    // Every other row: reaching it is finishing it. The work behind these
    // steps happens once (a key was saved, a record was added), and only the
    // section the current step names is re-run on this request, so a row from
    // a minute-old cache cannot be told apart from a fresh one. Drawing that
    // distinction is what made finished steps flicker amber and flip green
    // while the Owner was three screens away.
    else if (verified(id, input.checks, input.setup, input.onboardingCompletedAt) || reached) state = "done";
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

/** The subdomain to propose from the website address: affiliates. on the site's own domain, www dropped. */
export function suggestSubdomain(websiteUrl: string): string {
  try {
    const host = new URL(websiteUrl).hostname.replace(/^www\./, "");
    return host ? `affiliates.${host}` : "";
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
