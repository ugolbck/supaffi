import { describe, it, expect } from "vitest";
import { resendKeyWorks, sendingDomainVerified, resendDomainsUrl } from "@/lib/checks/email";

const client = (domains: { name: string; status: string }[], error: string | null = null) => () => ({
  domains: { list: async () => (error ? { data: null, error: { message: error } } : { data: { data: domains }, error: null }) },
});

describe("resendKeyWorks", () => {
  it("passes when the API answers", async () => {
    expect((await resendKeyWorks("re_x", client([]))).ok).toBe(true);
  });
  it("fails when Resend rejects the key", async () => {
    const result = await resendKeyWorks("re_x", client([], "API key is invalid"));
    expect(result.ok).toBe(false);
  });
  it("refuses something that is not a Resend key", async () => {
    expect((await resendKeyWorks("nope", client([]))).ok).toBe(false);
  });
});

describe("sendingDomainVerified", () => {
  it("passes when the exact domain is verified", async () => {
    const result = await sendingDomainVerified("re_x", "affiliates.instantgradient.com",
      client([{ name: "affiliates.instantgradient.com", status: "verified" }]));
    expect(result.ok).toBe(true);
  });
  it("fails when only the parent domain is verified", async () => {
    // Resend covers the exact domain only; a subdomain has to be added and
    // verified on its own.
    const result = await sendingDomainVerified("re_x", "affiliates.instantgradient.com",
      client([{ name: "instantgradient.com", status: "verified" }]));
    expect(result.ok).toBe(false);
  });
  it("fails when the domain is added but pending", async () => {
    const result = await sendingDomainVerified("re_x", "affiliates.instantgradient.com",
      client([{ name: "affiliates.instantgradient.com", status: "pending" }]));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/pending/i);
  });
  it("fails when the domain is not in Resend at all", async () => {
    const result = await sendingDomainVerified("re_x", "affiliates.instantgradient.com", client([]));
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/add/i);
  });

  it("refuses a verified parent domain", async () => {
    // Resend covers addresses at the exact domain. A subdomain has to be
    // added and verified on its own, so a parent is not a pass.
    const result = await sendingDomainVerified(
      "re_x",
      "affiliates.dev.mokkit.co",
      client([{ name: "mokkit.co", status: "verified" }])
    );
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("affiliates.dev.mokkit.co");
  });

  it("passes only on the exact domain", async () => {
    const result = await sendingDomainVerified(
      "re_x",
      "affiliates.dev.mokkit.co",
      client([{ name: "affiliates.dev.mokkit.co", status: "verified" }])
    );
    expect(result.ok).toBe(true);
  });

  it("does not depend on which domain Resend lists first", async () => {
    const both = [
      { name: "mokkit.co", status: "verified" },
      { name: "affiliates.dev.mokkit.co", status: "pending" },
    ];
    const forwards = await sendingDomainVerified("re_x", "affiliates.dev.mokkit.co", client(both));
    const backwards = await sendingDomainVerified(
      "re_x",
      "affiliates.dev.mokkit.co",
      client([...both].reverse())
    );
    expect(forwards).toEqual(backwards);
    expect(forwards.ok).toBe(false);
  });
});

describe("resendDomainsUrl", () => {
  it("is the domains page", () => {
    expect(resendDomainsUrl()).toBe("https://resend.com/domains");
  });
});
