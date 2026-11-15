import { describe, it, expect, vi, afterEach } from "vitest";
import {
  validateProductInput,
  validateStripeCredentials,
  normalizeDomain,
  normalizeWebsiteUrl,
} from "@/lib/productValidation";

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

  describe("in production", () => {
    afterEach(() => {
      vi.unstubAllEnvs();
    });

    const HOSTNAME_ERROR = "Domain must be a full hostname, like affiliates.example.com";

    it.each([
      "affiliates.instantgradient.com",
      "a.io",
      "xn--bcher-kva.example",
      "my-shop.co.uk",
      "  Affiliates.Example.COM ",
    ])("accepts the public hostname %s", (domain) => {
      vi.stubEnv("NODE_ENV", "production");
      expect(validateProductInput({ ...validInput, domain })).toBeNull();
    });

    it.each([
      ["a port", "affiliates.example.com:8443"],
      ["a local name with a port", "localhost:3000"],
      ["localhost", "localhost"],
      ["a single-label internal name", "app"],
      ["a trailing dot", "affiliates.example.com."],
      ["an IPv4 address", "203.0.113.7"],
      ["an IPv4 address with a port", "203.0.113.7:443"],
      ["an IPv6 address", "[2001:db8::1]"],
      ["a bare IPv6 address", "2001:db8::1"],
      ["an underscore", "my_shop.example.com"],
      ["a label starting with a hyphen", "-shop.example.com"],
      ["a label ending with a hyphen", "shop-.example.com"],
      ["an empty label", "shop..example.com"],
      ["a leading dot", ".example.com"],
      ["a label over 63 characters", `${"a".repeat(64)}.example.com`],
      ["a name over 253 characters", `${"a".repeat(60)}.`.repeat(5) + "com"],
      ["a wildcard", "*.example.com"],
      ["a user part", "user@example.com"],
    ])("rejects %s", (_label, domain) => {
      vi.stubEnv("NODE_ENV", "production");
      expect(validateProductInput({ ...validInput, domain })).toBe(HOSTNAME_ERROR);
    });

    it("still refuses the Instance's own domain", () => {
      vi.stubEnv("NODE_ENV", "production");
      expect(validateProductInput({ ...validInput, domain: "supaffi.example.com" }, "supaffi.example.com")).toBe(
        "That domain serves this Supaffi instance."
      );
    });
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

describe("normalizeDomain", () => {
  it("trims and lowercases the domain so it matches a real Host header/SNI", () => {
    expect(normalizeDomain(" Affiliates.InstantGradient.com ")).toBe(
      "affiliates.instantgradient.com"
    );
  });
});

describe("normalizeWebsiteUrl", () => {
  it("adds https to a bare domain", () => {
    expect(normalizeWebsiteUrl(" pagecast.app ")).toBe("https://pagecast.app");
  });

  it("keeps an address that already has a scheme", () => {
    expect(normalizeWebsiteUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(normalizeWebsiteUrl("https://pagecast.app/pricing")).toBe("https://pagecast.app/pricing");
  });

  it("leaves an empty value empty, for the required check", () => {
    expect(normalizeWebsiteUrl("  ")).toBe("");
  });
});
