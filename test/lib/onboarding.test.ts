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
  it("has six steps when email is required, the finished screen not being one", () => {
    expect(stepIds(true)).toHaveLength(6);
    expect(stepIds(true)).not.toContain("link");
  });
  it("has no webhook step: the key's own save creates the endpoint", () => {
    expect(stepIds(true)).not.toContain("stripe-webhook");
  });
  it("drops the email step when the instance prints emails", () => {
    expect(stepIds(false)).not.toContain("email");
    expect(stepIds(false)).toHaveLength(5);
  });
});

describe("stepStates", () => {
  it("marks the product done and the current step current", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "subdomain" });
    expect(states.find((s) => s.id === "product")?.state).toBe("done");
    expect(states.find((s) => s.id === "subdomain")?.state).toBe("current");
    expect(states.find((s) => s.id === "terms")?.state).toBe("upcoming");
  });

  it("shows a stored step as done once it is behind the user", () => {
    const states = stepStates({
      setup: setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }),
      checks: checks({ stripe: { key: ok, webhook: no } }),
      onboardingCompletedAt: null,
      current: "email",
    });
    expect(states.find((s) => s.id === "stripe-key")?.state).toBe("done");
  });

  it("a step the user walked past is waiting while its check says no", () => {
    // Pressing Continue is not evidence. A record that was deleted, or a
    // certificate that never issued, has to keep showing amber wherever the
    // Owner is standing, or the rail says the setup is finished when it is
    // not.
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
    for (const id of ["stripe-key", "email", "terms", "tracking"]) {
      expect(states.find((s) => s.id === id)?.state, id).toBe("done");
    }
  });

  it("a step nobody has reached is still upcoming", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "subdomain" });
    expect(states.find((s) => s.id === "stripe-key")?.state).toBe("upcoming");
    expect(states.find((s) => s.id === "tracking")?.state).toBe("upcoming");
  });

  it("needs both halves of email, not just the key that was stored", () => {
    // A key Resend accepts and a domain it will not send from delivers
    // nothing, so the step is not finished and the rail does not say it is.
    const states = stepStates({
      setup: setup({ emailConnected: true }),
      checks: checks({ email: { key: ok, domain: no } }),
      onboardingCompletedAt: null,
      current: "terms",
    });
    expect(states.find((s) => s.id === "email")?.state).toBe("waiting");
  });

  it("ticks email once the key works and the domain is verified", () => {
    const states = stepStates({
      setup: setup({ emailConnected: true }),
      checks: checks({ email: { key: ok, domain: ok } }),
      onboardingCompletedAt: null,
      current: "terms",
    });
    expect(states.find((s) => s.id === "email")?.state).toBe("done");
  });

  it("does not hold the subdomain open where nothing outside can reach the instance", () => {
    const states = stepStates({
      setup: setup(),
      checks: checks(),
      onboardingCompletedAt: null,
      current: "terms",
      dnsUnavailable: true,
    });
    expect(states.find((s) => s.id === "subdomain")?.state).toBe("done");
  });

  it("product stays current while the user is on it", () => {
    const states = stepStates({ setup: setup(), checks: checks(), onboardingCompletedAt: null, current: "product" });
    expect(states.find((s) => s.id === "product")?.state).toBe("current");
  });
});

describe("displayStep", () => {
  it("counts the steps there are, with nothing added for work already done", () => {
    expect(displayStep("product", true)).toEqual({ index: 1, total: 6 });
    expect(displayStep("terms", false)).toEqual({ index: 4, total: 5 });
  });
});

describe("stepIndex", () => {
  it("counts from one and shifts once email drops out", () => {
    expect(stepIndex("stripe-key", true)).toBe(3);
    expect(stepIndex("terms", false)).toBe(4);
  });
});

describe("navigation", () => {
  it("walks forward and back, skipping email when not required", () => {
    expect(nextStep("stripe-key", true)).toBe("email");
    expect(nextStep("stripe-key", false)).toBe("terms");
    expect(previousStep("terms", false)).toBe("stripe-key");
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
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true }), null)).toBe("email");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true }), null)).toBe("terms");
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard" }), null)).toBe("tracking");
  });
  it("moves past the key once it is stored, webhook or not", () => {
    // The endpoint is made in the same save as the key, so a stored key with
    // no webhook is a local instance, and nothing further to ask for.
    expect(resumeStep(setup({ stripeKeyStored: true, stripeWebhookStored: false }), null)).toBe("email");
  });
  it("lands on the link when everything is stored but the owner never saw it", () => {
    expect(resumeStep(setup({ stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, emailConnected: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBeNull();
  });
  it("lands on the link when email is not required and the rest is stored", () => {
    expect(resumeStep(setup({ emailRequired: false, stripeConnected: true, stripeKeyStored: true, stripeWebhookStored: true, firstProgramSlug: "standard", trackingStatus: "awaiting-sale" }), null)).toBeNull();
  });
});

describe("suggestSubdomain", () => {
  it("prefixes go to the site's host", () => {
    expect(suggestSubdomain("https://instantgradient.com")).toBe("go.instantgradient.com");
    expect(suggestSubdomain("https://www.mokkit.co/pricing")).toBe("go.mokkit.co");
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
    expect(checkSectionFor("email")).toBe("email");
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
    expect(rehomeSubdomain("localhost:3600", "http://localhost:3600", "https://mokkit.co")).toBe("go.mokkit.co");
  });

  it("leaves the address alone when the new website yields nothing usable", () => {
    expect(rehomeSubdomain("affiliates.mokkit.co", "https://mokkit.co", "not a url")).toBe("affiliates.mokkit.co");
  });
});
