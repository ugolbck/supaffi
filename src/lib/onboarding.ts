import type { ProductSetup } from "@/lib/productSetup";
import type { ProductChecks } from "@/lib/checks/product";

export type StepId =
  | "product"
  | "subdomain"
  | "stripe-key"
  | "stripe-webhook"
  | "email-key"
  | "email-domain"
  | "terms"
  | "tracking"
  | "link";

export type StepState = "done" | "waiting" | "current" | "upcoming";
export type Step = { id: StepId; label: string; index: number; state: StepState };

const ALL: StepId[] = [
  "product",
  "subdomain",
  "stripe-key",
  "stripe-webhook",
  "email-key",
  "email-domain",
  "terms",
  "tracking",
  "link",
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
  link: "Your link",
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
      // Nothing is stored for it. The subdomain is written when the product
      // is created and its DNS state is a live check, not stored data, so it
      // never holds anyone up: the rail's light says whether it resolves.
      return true;
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
    case "link":
      return onboardingCompletedAt !== null;
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
    let state: StepState;
    // The current step reads current, full stop, with one exception: link
    // is the finished state itself, so once onboarding is complete it reads
    // done even while the user is standing on it.
    if (id === "link" && input.onboardingCompletedAt) state = "done";
    else if (id === input.current) state = "current";
    else if (index > currentIndex) state = "upcoming";
    else if (verified(id, input.checks, input.setup, input.onboardingCompletedAt)) state = "done";
    else state = "waiting";
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

/** Where to drop someone who left partway. The first step whose data is not stored, after product. */
export function resumeStep(setup: ProductSetup, onboardingCompletedAt: Date | null): StepId {
  const ids = stepIds(setup.emailRequired).filter((id) => id !== "product");
  for (const id of ids) {
    if (!stored(id, setup, onboardingCompletedAt)) return id;
  }
  return "link";
}
