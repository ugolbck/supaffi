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
  it("passes when the parent domain is verified", async () => {
    const result = await sendingDomainVerified("re_x", "affiliates.instantgradient.com",
      client([{ name: "instantgradient.com", status: "verified" }]));
    expect(result.ok).toBe(true);
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
    expect(result.detail).toMatch(/not added/i);
  });
});

describe("resendDomainsUrl", () => {
  it("is the domains page", () => {
    expect(resendDomainsUrl()).toBe("https://resend.com/domains");
  });
});
