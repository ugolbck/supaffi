import { describe, it, expect } from "vitest";
import { trackingScriptPrompt, checkoutPrompt } from "@/lib/integrationPrompt";

describe("trackingScriptPrompt", () => {
  it("carries the snippet and the site it belongs on", () => {
    const prompt = trackingScriptPrompt({
      websiteUrl: "https://instantgradient.com",
      scriptTag: '<script src="https://affiliates.instantgradient.com/track.js" async></script>',
    });
    expect(prompt).toContain("https://instantgradient.com");
    expect(prompt).toContain("track.js");
    // Written at an assistant, not at a colleague.
    expect(prompt).not.toMatch(/developer/i);
  });
});

describe("checkoutPrompt", () => {
  it("carries the snippet and protects metadata already there", () => {
    const prompt = checkoutPrompt({ checkoutSnippet: "await stripe.checkout.sessions.create({});" });
    expect(prompt).toContain("stripe.checkout.sessions.create");
    expect(prompt).toContain("already being set");
  });
});
