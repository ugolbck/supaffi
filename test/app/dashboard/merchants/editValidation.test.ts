import { describe, it, expect } from "vitest";
import { validateMerchantEditInput } from "@/app/dashboard/merchants/new/validation";

describe("validateMerchantEditInput", () => {
  it("accepts name/domain with all credential fields blank", () => {
    expect(
      validateMerchantEditInput({
        name: "Renamed",
        domain: "renamed.example.com",
        stripeSecretKey: "",
        stripeWebhookSecret: "",
        emailProviderConfig: "",
      })
    ).toBeNull();
  });

  it("rejects a provided Stripe secret key not starting with sk_", () => {
    expect(
      validateMerchantEditInput({
        name: "Renamed",
        domain: "renamed.example.com",
        stripeSecretKey: "not-a-key",
        stripeWebhookSecret: "",
        emailProviderConfig: "",
      })
    ).toBe("Stripe secret key must start with sk_");
  });

  it("still rejects a missing name", () => {
    expect(
      validateMerchantEditInput({
        name: "",
        domain: "renamed.example.com",
        stripeSecretKey: "",
        stripeWebhookSecret: "",
        emailProviderConfig: "",
      })
    ).toBe("Name is required");
  });
});
