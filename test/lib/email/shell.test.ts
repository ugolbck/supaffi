import { describe, it, expect } from "vitest";
import { emailShell } from "@/components/email/shell";

describe("emailShell", () => {
  it("carries the action href through verbatim", () => {
    const href = "https://affiliates.instantgradient.com/affiliates/verify?token=abc123&x=1";
    const html = emailShell({
      merchantName: "InstantGradient",
      heading: "Log in to your affiliate account",
      body: "This link expires in 15 minutes and can only be used once.",
      action: { label: "Log in", href },
    });

    expect(html).toContain(`href="${href}"`);
  });

  it("escapes the merchant name", () => {
    const html = emailShell({
      merchantName: `Bob's <Widgets> & "Co"`,
      heading: "Log in to your affiliate account",
      body: "Body text.",
      action: { label: "Log in", href: "https://example.com/verify" },
    });

    expect(html).not.toContain(`Bob's <Widgets> & "Co"`);
    expect(html).toContain("Bob&#39;s &lt;Widgets&gt; &amp; &quot;Co&quot;");
  });

  it("emits no style block", () => {
    const html = emailShell({
      merchantName: "InstantGradient",
      heading: "Log in to your affiliate account",
      body: "Body text.",
      action: { label: "Log in", href: "https://example.com/verify" },
    });

    expect(html.toLowerCase()).not.toContain("<style");
  });

  it("renders without an action when none is given", () => {
    const html = emailShell({
      merchantName: "InstantGradient",
      heading: "A heading",
      body: "A body.",
    });

    expect(html).toContain("A heading");
    expect(html).toContain("A body.");
    expect(html).not.toContain("<a href");
  });
});
