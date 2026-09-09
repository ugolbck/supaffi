import { describe, it, expect } from "vitest";
import { stepIds, stepIndex, stepStates, nextStep, previousStep, resumeStep, stepPath, suggestSubdomain, backToDashboardHref } from "@/lib/onboarding";
import type { ProductSetup } from "@/lib/productSetup";
import type { ProductChecks } from "@/lib/checks/product";

const ok = { ok: true, detail: "" };
const no = { ok: false, detail: "" };

const setup = (over: Partial<ProductSetup> = {}): ProductSetup => ({
  stripeConnected: false,
  stripeKeyStored: false,
  stripeWebhookStored: false,
  emailConnected: false,
  emailRequired: true,
  integrationsConnected: false,
  firstProgramSlug: null,
  trackingStatus: "not-started",
  affiliateCount: 0,
  doneCount: 0,
  totalSteps: 3,
  complete: false,
  ...over,
});

const checks = (over: Partial<ProductChecks> = {}): ProductChecks => ({
  dns: { resolves: no, https: no, certificate: no },
  stripe: { key: no, webhook: no },
  email: { key: no, domain: no },
  tracking: { script: no },
  ...over,
});

describe("stepIds", () => {
  it("has nine steps when email is required", () => {
    expect(stepIds(true)).toHaveLength(9);
  });
  it("drops both email steps when the instance prints emails", () => {
    expect(stepIds(false)).not.toContain("email-key");
    expect(stepIds(false)).not.toContain("email-domain");
  });
});

describe("stepStates", () => {
  it("marks the product done and the current step current", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "subdomain" });
    expect(states.find((s) => s.id === "product")?.state).toBe("done");
    expect(states.find((s) => s.id === "subdomain")?.state).toBe("current");
    expect(states.find((s) => s.id === "terms")?.state).toBe("upcoming");
  });

  it("shows a stored but unverified step as waiting once it is behind the user", () => {
    const states = stepStates({
      setup: setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }),
      checks: checks({ stripe: { key: ok, webhook: no } }),
      onboardingCompletedAt: null,
      current: "email-key",
    });
    expect(states.find((s) => s.id === "stripe-key")?.state).toBe("done");
    expect(states.find((s) => s.id === "stripe-webhook")?.state).toBe("waiting");
  });

  it("subdomain is done only when all three lights are green", () => {
    const partial = stepStates({
      setup: setup(),
      checks: checks({ dns: { resolves: ok, https: ok, certificate: no } }),
      onboardingCompletedAt: null,
      current: "terms",
    });
    expect(partial.find((s) => s.id === "subdomain")?.state).toBe("waiting");
    const full = stepStates({
      setup: setup(),
      checks: checks({ dns: { resolves: ok, https: ok, certificate: ok } }),
      onboardingCompletedAt: null,
      current: "terms",
    });
    expect(full.find((s) => s.id === "subdomain")?.state).toBe("done");
  });

  it("link is done once onboarding was completed", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: new Date(), current: "link" });
    expect(states.find((s) => s.id === "link")?.state).toBe("done");
  });

  it("stays current even once its own check has passed", () => {
    const states = stepStates({
      setup: setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }),
      checks: checks({ stripe: { key: ok, webhook: no } }),
      onboardingCompletedAt: null,
      current: "stripe-key",
    });
    expect(states.find((s) => s.id === "stripe-key")?.state).toBe("current");
  });

  it("product stays current while the user is on it", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "product" });
    expect(states.find((s) => s.id === "product")?.state).toBe("current");
  });
});

describe("stepIndex", () => {
  it("counts from one and shifts once email drops out", () => {
    expect(stepIndex("stripe-key", true)).toBe(3);
    expect(stepIndex("terms", false)).toBe(5);
  });
});

describe("navigation", () => {
  it("walks forward and back, skipping email when not required", () => {
    expect(nextStep("stripe-webhook", true)).toBe("email-key");
    expect(nextStep("stripe-webhook", false)).toBe("terms");
    expect(previousStep("terms", false)).toBe("stripe-webhook");
    expect(nextStep("link", true)).toBeNull();
    expect(previousStep("product", true)).toBeNull();
  });

  it("builds the path", () => {
    expect(stepPath("instantgradient", "stripe-key")).toBe("/onboarding/instantgradient/stripe-key");
  });
});

describe("resumeStep", () => {
  it("lands on the first step whose stored data is missing", () => {
    // Nothing is stored for the subdomain, so it never holds a resume up: the
    // first thing anyone can still owe is the Stripe key.
    expect(resumeStep(setup(), null)).toBe("stripe-key");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }), null)).toBe("email-key");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true }), null)).toBe("terms");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard" }), null)).toBe("tracking");
  });
  it("lands on the webhook step when only the Stripe key is stored", () => {
    expect(resumeStep(setup({ stripeKeyStored: true, stripeWebhookStored: false }), null)).toBe("stripe-webhook");
  });
  it("lands on the link when everything is stored but the owner never saw it", () => {
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBe("link");
  });
  it("lands on the link when email is not required and the rest is stored", () => {
    expect(resumeStep(setup({ emailRequired: false, stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBe("link");
  });
});

describe("suggestSubdomain", () => {
  it("prefixes affiliates to the site's host", () => {
    expect(suggestSubdomain("https://instantgradient.com")).toBe("affiliates.instantgradient.com");
    expect(suggestSubdomain("https://www.mokkit.co/pricing")).toBe("affiliates.mokkit.co");
  });
  it("gives nothing for an address it cannot read", () => {
    expect(suggestSubdomain("not a url")).toBe("");
  });
});

describe("backToDashboardHref", () => {
  it("offers the dashboard only when another product has finished onboarding", () => {
    expect(backToDashboardHref([])).toBeNull();
    expect(backToDashboardHref([{ onboardingCompletedAt: null }])).toBeNull();
    expect(backToDashboardHref([{ onboardingCompletedAt: null }, { onboardingCompletedAt: new Date() }])).toBe("/dashboard");
  });
});
