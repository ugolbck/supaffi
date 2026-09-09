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
      // No field records it directly. Its DNS state is a live check, not
      // stored data, so treat it as handled once anything past it exists:
      // reaching those steps means the domain was already live.
      return (
        setup.stripeConnected ||
        setup.emailConnected ||
        setup.firstProgramSlug !== null ||
        setup.trackingStatus !== "not-started"
      );
    case "stripe-key":
    case "stripe-webhook":
      return setup.stripeConnected;
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
    // Ahead of the user is always upcoming, whatever its own data says.
    // Otherwise a verified step reads as done even when it is the one the
    // user is standing on: revisiting a finished step should not hide that
    // it is finished. Only an unverified current step reads as current.
    if (index > currentIndex) state = "upcoming";
    else if (verified(id, input.checks, input.setup, input.onboardingCompletedAt)) state = "done";
    else if (id === input.current) state = "current";
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

/** Where to drop someone who left partway. The first step whose data is not stored, after product. */
export function resumeStep(setup: ProductSetup, onboardingCompletedAt: Date | null): StepId {
  const ids = stepIds(setup.emailRequired).filter((id) => id !== "product");
  for (const id of ids) {
    if (!stored(id, setup, onboardingCompletedAt)) return id;
  }
  return "link";
}
