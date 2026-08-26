import { describe, it, expect, vi, beforeEach } from "vitest";

const sendMock = vi.fn().mockResolvedValue({ data: { id: "email_123" }, error: null });

vi.mock("resend", () => ({
  Resend: vi.fn().mockImplementation(function() {
    return { emails: { send: sendMock } };
  }),
}));

vi.mock("@/lib/crypto", () => ({
  decrypt: vi.fn().mockReturnValue("re_test_key"),
}));

import { Resend } from "resend";
import { decrypt } from "@/lib/crypto";
import { sendAffiliateMagicLinkEmail } from "@/lib/email/affiliateMagicLink";

describe("sendAffiliateMagicLinkEmail", () => {
  beforeEach(() => {
    sendMock.mockClear();
    vi.mocked(Resend).mockClear();
    vi.mocked(decrypt).mockClear();
  });

  it("decrypts the Merchant's own Resend key and sends with a verify link scoped to the Merchant's domain", async () => {
    await sendAffiliateMagicLinkEmail(
      {
        name: "InstantGradient",
        domain: "affiliates.instantgradient.com",
        emailProviderConfigEnc: "enc-blob",
      },
      { email: "sarah@example.com" },
      "raw-token-abc"
    );

    expect(decrypt).toHaveBeenCalledWith("enc-blob");
    expect(Resend).toHaveBeenCalledWith("re_test_key");

    expect(sendMock).toHaveBeenCalledTimes(1);
    const call = sendMock.mock.calls[0][0];
    expect(call.to).toBe("sarah@example.com");
    expect(call.html).toContain(
      "https://affiliates.instantgradient.com/affiliates/verify?token=raw-token-abc"
    );
    expect(call.subject).toContain("InstantGradient");
  });

  it("throws when Resend resolves with an error (e.g. unverified sending domain)", async () => {
    sendMock.mockResolvedValueOnce({
      data: null,
      error: { name: "validation_error", message: "domain not verified" },
    });

    await expect(
      sendAffiliateMagicLinkEmail(
        {
          name: "InstantGradient",
          domain: "affiliates.instantgradient.com",
          emailProviderConfigEnc: "enc-blob",
        },
        { email: "sarah@example.com" },
        "raw-token-abc"
      )
    ).rejects.toThrow(/domain not verified/);
  });
});
