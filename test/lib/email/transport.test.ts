import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null });

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function () {
    return { emails: { send: sendMock } };
  }),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("re_test_key"),
}));

import { Resend } from "resend";
import { deliveryMode, sendEmail } from "@/lib/email/transport";

const merchant = {
  name: "InstantGradient",
  domain: "affiliates.instantgradient.com",
  emailProviderConfigEnc: "enc-blob",
};

const email = {
  to: "sarah@example.com",
  subject: "Log in",
  html: '<p><a href="https://affiliates.instantgradient.com/affiliates/verify?token=abc">Log in</a></p>',
};

describe("deliveryMode", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("defaults to sending, so the unsafe direction is always the one someone typed", () => {
    // Discarding affiliate login emails locks every affiliate out and reports
    // nothing anywhere, because not sending succeeded. It must never be what
    // happens when a variable is missing.
    vi.stubEnv("EMAIL_DELIVERY", undefined);
    expect(deliveryMode()).toBe("send");
  });

  it("does not read NODE_ENV", () => {
    // Branching on the name of an environment is the 12-factor anti-pattern:
    // it does not survive staging, QA, or a second developer's setup. The
    // default above is what makes production safe, not an environment check.
    vi.stubEnv("EMAIL_DELIVERY", undefined);
    vi.stubEnv("NODE_ENV", "production");
    expect(deliveryMode()).toBe("send");

    vi.stubEnv("NODE_ENV", "development");
    expect(deliveryMode()).toBe("send");
  });

  it("honours console when asked", () => {
    vi.stubEnv("EMAIL_DELIVERY", "console");
    expect(deliveryMode()).toBe("console");
  });

  it("rejects a value it does not recognise instead of guessing", () => {
    // A typo like EMAIL_DELIVERY=Console would otherwise fall through to the
    // default and look like it had been honoured. It names a provider here on
    // purpose: providers are per Merchant and never belong in this variable.
    vi.stubEnv("EMAIL_DELIVERY", "smtp");
    expect(() => deliveryMode()).toThrow(/Unknown EMAIL_DELIVERY/);

    // Case matters, which is the typo the message above is really for.
    vi.stubEnv("EMAIL_DELIVERY", "Console");
    expect(() => deliveryMode()).toThrow(/Unknown EMAIL_DELIVERY/);
  });

  it("treats a padded or empty value the way whoever typed it meant", () => {
    // Both are easy to leave behind in a hand-edited .env.
    vi.stubEnv("EMAIL_DELIVERY", " console ");
    expect(deliveryMode()).toBe("console");

    vi.stubEnv("EMAIL_DELIVERY", "");
    expect(deliveryMode()).toBe("send");
  });
});

describe("sendEmail", () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.mocked(Resend).mockClear();
    vi.unstubAllEnvs();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("prints the email instead of sending it in console mode", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("EMAIL_DELIVERY", "console");

    await sendEmail(merchant, email);

    expect(Resend).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();

    const printed = warn.mock.calls[0][0] as string;
    expect(printed).toContain("sarah@example.com");
    // ADR 0008 leans on this exact string as the only signal that a production
    // instance is discarding mail, so it is not free to drift.
    expect(printed).toContain("EMAIL NOT SENT");
    // The link is the entire point: it is what gets pasted into the browser.
    expect(printed).toContain(
      "https://affiliates.instantgradient.com/affiliates/verify?token=abc"
    );
  });

  it("needs no Resend key in console mode, since that is the state it exists for", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.stubEnv("EMAIL_DELIVERY", "console");

    await expect(
      sendEmail({ ...merchant, emailProviderConfigEnc: null }, email)
    ).resolves.toBeUndefined();
  });

  it("sends through the Merchant's own key, from the Merchant's own domain", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "send");

    await sendEmail(merchant, email);

    expect(Resend).toHaveBeenCalledWith("re_test_key");
    const call = sendMock.mock.calls[0][0];
    expect(call.from).toBe(
      "InstantGradient Affiliates <affiliates@affiliates.instantgradient.com>"
    );
    expect(call.to).toBe("sarah@example.com");
  });

  it("strips characters that would let a Merchant name break out of the From header", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "send");

    await sendEmail({ ...merchant, name: 'Evil <a@b.com>, "x"' }, email);

    // The angle brackets and comma are what would have added a recipient. A
    // bare address left as display text cannot.
    expect(sendMock.mock.calls[0][0].from).toBe(
      "Evil a@b.com x Affiliates <affiliates@affiliates.instantgradient.com>"
    );
  });

  it("strips CR and LF, which end a header outright rather than just widening it", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "send");

    await sendEmail(
      { ...merchant, name: "Evil\r\nBcc: victim@example.com" },
      { ...email, subject: "Hi\r\nX-Injected: 1" }
    );

    const call = sendMock.mock.calls[0][0];
    expect(call.from).not.toMatch(/[\r\n]/);
    expect(call.subject).not.toMatch(/[\r\n]/);
  });

  it("sanitises the domain too, which product validation does not check for header safety", async () => {
    // validateProductInput rejects slashes and whitespace in a domain but
    // permits quotes, commas and angle brackets.
    vi.stubEnv("EMAIL_DELIVERY", "send");

    await sendEmail({ ...merchant, domain: 'a.com>,x@evil.com<b' }, email);

    expect(sendMock.mock.calls[0][0].from).toBe(
      "InstantGradient Affiliates <affiliates@a.comx@evil.comb>"
    );
  });

  it("throws when the Merchant has connected no email provider at all", async () => {
    vi.stubEnv("EMAIL_DELIVERY", "send");

    await expect(
      sendEmail({ ...merchant, emailProviderConfigEnc: null }, email)
    ).rejects.toThrow(/not connected/);
  });

  it("throws when Resend resolves with an error, e.g. an unverified sending domain", async () => {
    // Resend does not reject the promise. Unhandled, the affiliate is told to
    // check an inbox nothing will ever arrive in.
    vi.stubEnv("EMAIL_DELIVERY", "send");
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "domain not verified" },
    });

    await expect(sendEmail(merchant, email)).rejects.toThrow(/domain not verified/);
  });
});
