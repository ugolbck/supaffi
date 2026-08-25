import { describe, it, expect } from "vitest";
import { validateMerchantInput } from "@/app/dashboard/merchants/new/validation";

const validInput = {
  name: "InstantGradient",
  domain: "affiliates.instantgradient.com",
  stripeSecretKey: "sk_test_abc123",
  stripeWebhookSecret: "whsec_abc123",
  emailProviderConfig: "resend_api_key_abc",
};

describe("validateMerchantInput", () => {
  it("accepts valid input", () => {
    expect(validateMerchantInput(validInput)).toBeNull();
  });

  it("rejects a missing name", () => {
    expect(validateMerchantInput({ ...validInput, name: "  " })).toBe("Name is required");
  });

  it("rejects a domain containing a protocol", () => {
    expect(
      validateMerchantInput({ ...validInput, domain: "https://affiliates.instantgradient.com" })
    ).toBe("Domain must be a bare hostname (no https://, no path)");
  });

  it("rejects a domain containing a path", () => {
    expect(
      validateMerchantInput({ ...validInput, domain: "affiliates.instantgradient.com/foo" })
    ).toBe("Domain must be a bare hostname (no https://, no path)");
  });

  it("rejects a Stripe secret key not starting with sk_", () => {
    expect(validateMerchantInput({ ...validInput, stripeSecretKey: "not-a-key" })).toBe(
      "Stripe secret key must start with sk_"
    );
  });

  it("rejects a Stripe webhook secret not starting with whsec_", () => {
    expect(validateMerchantInput({ ...validInput, stripeWebhookSecret: "not-a-secret" })).toBe(
      "Stripe webhook signing secret must start with whsec_"
    );
  });

  it("rejects a missing email provider config", () => {
    expect(validateMerchantInput({ ...validInput, emailProviderConfig: "" })).toBe(
      "Email provider configuration is required"
    );
  });
});
