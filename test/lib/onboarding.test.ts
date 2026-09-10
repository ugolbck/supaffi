import { describe, it, expect } from "vitest";
import { stepIds, stepIndex, displayStep, stepStates, nextStep, previousStep, resumeStep, stepPath, suggestSubdomain, backToDashboardHref, checkSectionFor, siteHost, splitSubdomain, rehomeSubdomain, dnsRecordName } from "@/lib/onboarding";
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
  it("has eight steps when email is required, the finished screen not being one", () => {
    expect(stepIds(true)).toHaveLength(8);
    expect(stepIds(true)).not.toContain("link");
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

  it("stays current even once its own check has passed", () => {
    const states = stepStates({
      setup: setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }),
      checks: checks({ stripe: { key: ok, webhook: no } }),
      onboardingCompletedAt: null,
      current: "stripe-key",
    });
    expect(states.find((s) => s.id === "stripe-key")?.state).toBe("current");
  });

  it("keeps finished steps finished when the user navigates back to an earlier one", () => {
    // The trap: standing on subdomain used to demote every completed step
    // after it to "upcoming", which the rail renders grey and unclickable.
    const states = stepStates({
      setup: setup({
        stripeConnected: true,
        stripeKeyStored: true,
        stripeWebhookStored: true,
        emailConnected: true,
        firstProgramSlug: "standard",
        trackingStatus: "verified",
      }),
      checks: checks({
        stripe: { key: ok, webhook: ok },
        email: { key: ok, domain: ok },
        tracking: { script: ok },
      }),
      onboardingCompletedAt: null,
      current: "subdomain",
    });
    for (const id of ["stripe-key", "stripe-webhook", "email-key", "email-domain", "terms", "tracking"]) {
      expect(states.find((s) => s.id === id)?.state, id).toBe("done");
    }
  });

  it("a step that was walked past but never confirmed reads as waiting, not upcoming", () => {
    const states = stepStates({
      setup: setup({ stripeKeyStored: true }),
      checks: checks(),
      onboardingCompletedAt: null,
      current: "terms",
    });
    expect(states.find((s) => s.id === "stripe-webhook")?.state).toBe("waiting");
  });

  it("product stays current while the user is on it", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "product" });
    expect(states.find((s) => s.id === "product")?.state).toBe("current");
  });
});

describe("displayStep", () => {
  it("counts the two rows the rail already shows as ticked", () => {
    expect(displayStep("product", true)).toEqual({ index: 3, total: 10 });
    expect(displayStep("subdomain", false)).toEqual({ index: 4, total: 8 });
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
    expect(nextStep("tracking", true)).toBeNull();
    expect(previousStep("product", true)).toBeNull();
  });

  it("builds the path", () => {
    expect(stepPath("instantgradient", "stripe-key")).toBe("/onboarding/instantgradient/stripe-key");
  });
});

describe("resumeStep", () => {
  it("lands on the first step whose stored data is missing", () => {
    // Nothing stored anywhere means the Owner never got past the subdomain.
    expect(resumeStep(setup(), null)).toBe("subdomain");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }), null)).toBe("email-key");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true }), null)).toBe("terms");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard" }), null)).toBe("tracking");
  });
  it("lands on the webhook step when only the Stripe key is stored", () => {
    expect(resumeStep(setup({ stripeKeyStored: true, stripeWebhookStored: false }), null)).toBe("stripe-webhook");
  });
  it("lands on the link when everything is stored but the owner never saw it", () => {
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBeNull();
  });
  it("lands on the link when email is not required and the rest is stored", () => {
    expect(resumeStep(setup({ emailRequired: false, stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBeNull();
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

describe("checkSectionFor", () => {
  it("names the one group of checks the step's screen shows", () => {
    expect(checkSectionFor("subdomain")).toBe("dns");
    expect(checkSectionFor("stripe-key")).toBe("stripe");
    expect(checkSectionFor("stripe-webhook")).toBe("stripe");
    expect(checkSectionFor("email-key")).toBe("email");
    expect(checkSectionFor("email-domain")).toBe("email");
    expect(checkSectionFor("tracking")).toBe("tracking");
    expect(checkSectionFor("product")).toBeNull();
    expect(checkSectionFor("terms")).toBeNull();
  });
});

describe("siteHost", () => {
  it("is the hostname, or the raw address when it cannot be read", () => {
    expect(siteHost("https://www.instantgradient.com/pricing")).toBe("www.instantgradient.com");
    expect(siteHost("instantgradient.com")).toBe("instantgradient.com");
  });
});

describe("splitSubdomain", () => {
  it("splits the label a user may change from the root they may not", () => {
    expect(splitSubdomain("affiliates.instantgradient.com", "https://instantgradient.com")).toEqual({
      prefix: "affiliates",
      suffix: ".instantgradient.com",
    });
  });

  it("ignores www on the website when matching the root", () => {
    expect(splitSubdomain("partners.mokkit.co", "https://www.mokkit.co")).toEqual({
      prefix: "partners",
      suffix: ".mokkit.co",
    });
  });

  it("refuses to split an address that is not under the product's own site", () => {
    expect(splitSubdomain("affiliates.somewhereelse.com", "https://instantgradient.com")).toBeNull();
    expect(splitSubdomain("localhost:3600", "http://localhost:3600")).toBeNull();
  });
});

describe("dnsRecordName", () => {
  it("keeps the middle labels when the site is on a subdomain", () => {
    // The zone is mokkit.co, so Cloudflare wants affiliates.dev, and the
    // prefix alone would create affiliates.mokkit.co instead.
    expect(dnsRecordName("affiliates.dev.mokkit.co")).toBe("affiliates.dev");
  });

  it("is just the prefix on a bare domain", () => {
    expect(dnsRecordName("go.mokkit.co")).toBe("go");
  });

  it("handles a public suffix without a suffix list", () => {
    expect(dnsRecordName("go.example.co.uk")).toBe("go");
  });

  it("returns the whole name when there is no zone to strip", () => {
    expect(dnsRecordName("mokkit.co")).toBe("mokkit.co");
  });
});

describe("rehomeSubdomain", () => {
  it("carries a chosen label onto the new site when the website is corrected", () => {
    expect(rehomeSubdomain("partners.instantgradient.com", "https://instantgradient.com", "https://mokkit.co")).toBe(
      "partners.mokkit.co"
    );
  });

  it("falls back to the default label when there was none to carry", () => {
    expect(rehomeSubdomain("localhost:3600", "http://localhost:3600", "https://mokkit.co")).toBe("affiliates.mokkit.co");
  });

  it("leaves the address alone when the new website yields nothing usable", () => {
    expect(rehomeSubdomain("affiliates.mokkit.co", "https://mokkit.co", "not a url")).toBe("affiliates.mokkit.co");
  });
});
