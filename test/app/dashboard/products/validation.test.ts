import { describe, it, expect } from "vitest";
import {
  validateProductInput,
  validateStripeCredentials,
  validateEmailProviderKey,
  normalizeDomain,
} from "@/app/dashboard/products/new/validation";

const validInput = {
  name: "InstantGradient",
  domain: "affiliates.instantgradient.com",
  websiteUrl: "https://example.com",
};

describe("validateProductInput", () => {
  it("accepts valid input", () => {
    expect(validateProductInput(validInput)).toBeNull();
  });

  it("rejects a missing name", () => {
    expect(validateProductInput({ ...validInput, name: "  " })).toBe("Name is required");
  });

  it("rejects a domain containing a protocol", () => {
    expect(
      validateProductInput({ ...validInput, domain: "https://affiliates.instantgradient.com" })
    ).toBe("Domain must be a bare hostname (no https://, no path)");
  });

  it("rejects a domain containing a path", () => {
    expect(
      validateProductInput({ ...validInput, domain: "affiliates.instantgradient.com/foo" })
    ).toBe("Domain must be a bare hostname (no https://, no path)");
  });

  it("rejects a website URL without a scheme", () => {
    expect(validateProductInput({ ...validInput, websiteUrl: "example.com" })).toBe(
      "Website URL must be a full address starting with http:// or https://"
    );
  });

  it("accepts a mixed-case, whitespace-padded domain (validated against the normalized form)", () => {
    expect(
      validateProductInput({ ...validInput, domain: " Affiliates.InstantGradient.com " })
    ).toBeNull();
  });

  it("rejects the Instance's own domain, which would take over the admin host", () => {
    expect(
      validateProductInput(
        { ...validInput, domain: "supaffi.example.com" },
        "supaffi.example.com"
      )
    ).toBe("That domain serves this Supaffi instance.");
  });

  it("compares against the Instance domain after normalizing, not before", () => {
    expect(
      validateProductInput(
        { ...validInput, domain: "  Supaffi.Example.COM " },
        "supaffi.example.com"
      )
    ).toBe("That domain serves this Supaffi instance.");
  });

  it("allows any other domain when an Instance domain is set", () => {
    expect(
      validateProductInput(
        { ...validInput, domain: "affiliates.instantgradient.com" },
        "supaffi.example.com"
      )
    ).toBeNull();
  });

  it("skips the check when no Instance domain is configured, so local development is unaffected", () => {
    expect(validateProductInput({ ...validInput, domain: "localhost:3000" }, "")).toBeNull();
  });
});

describe("validateStripeCredentials", () => {
  const valid = { secretKey: "sk_test_abc123", webhookSecret: "whsec_abc123" };

  it("accepts a well-formed pair", () => {
    expect(validateStripeCredentials(valid)).toBeNull();
  });

  it("accepts a restricted key, which is what the one-click link creates", () => {
    expect(validateStripeCredentials({ ...valid, secretKey: "rk_live_abc123" })).toBeNull();
  });

  it("rejects a key starting with neither prefix", () => {
    expect(validateStripeCredentials({ ...valid, secretKey: "not-a-key" })).toBe(
      "Stripe key must start with rk_ or sk_"
    );
  });

  it("rejects a webhook secret not starting with whsec_", () => {
    expect(validateStripeCredentials({ ...valid, webhookSecret: "not-a-secret" })).toBe(
      "Stripe webhook signing secret must start with whsec_"
    );
  });

  it("rejects blank fields on a first connect", () => {
    expect(validateStripeCredentials({ secretKey: "", webhookSecret: "" })).toBe(
      "Stripe key must start with rk_ or sk_"
    );
  });

  it("accepts blank fields when reconnecting, since blank means keep the stored one", () => {
    expect(validateStripeCredentials({ secretKey: "", webhookSecret: "" }, true)).toBeNull();
  });

  it("still rejects a malformed field when reconnecting", () => {
    expect(validateStripeCredentials({ secretKey: "nope", webhookSecret: "" }, true)).toBe(
      "Stripe key must start with rk_ or sk_"
    );
  });
});

describe("validateEmailProviderKey", () => {
  it("requires a key on a first connect", () => {
    expect(validateEmailProviderKey("  ")).toBe("Resend API key is required");
  });

  it("accepts a blank key when reconnecting", () => {
    expect(validateEmailProviderKey("", true)).toBeNull();
  });

  it("accepts a provided key", () => {
    expect(validateEmailProviderKey("re_abc123")).toBeNull();
  });
});

describe("normalizeDomain", () => {
  it("trims and lowercases the domain so it matches a real Host header/SNI", () => {
    expect(normalizeDomain(" Affiliates.InstantGradient.com ")).toBe(
      "affiliates.instantgradient.com"
    );
  });
});
