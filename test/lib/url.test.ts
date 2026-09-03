import { describe, it, expect } from "vitest";

import { isLocalDomain, originFor } from "@/lib/url";

// This decides whether a link Supaffi hands out is http or https. Getting it
// wrong in one direction produces a dead localhost link, and in the other a
// plaintext link to a real Merchant domain, so the boundary is worth pinning.
describe("isLocalDomain", () => {
  it("matches the local hosts a development instance actually runs on", () => {
    expect(isLocalDomain("localhost")).toBe(true);
    expect(isLocalDomain("localhost:3600")).toBe(true);
    expect(isLocalDomain("127.0.0.1:3600")).toBe(true);
    expect(isLocalDomain("0.0.0.0")).toBe(true);
    // The reserved suffix, used by anyone running several local hostnames.
    expect(isLocalDomain("supaffi.localhost")).toBe(true);
  });

  it("matches bracketed IPv6 loopback, which does not split on colons like a hostname", () => {
    expect(isLocalDomain("[::1]")).toBe(true);
    expect(isLocalDomain("[::1]:3600")).toBe(true);
  });

  it("is case insensitive, since a Host header is not required to be lowercase", () => {
    expect(isLocalDomain("LocalHost:3600")).toBe(true);
  });

  it("does not match a real domain that merely contains the word", () => {
    // The dangerous direction: a false positive here downgrades a real
    // Merchant's affiliate links to plaintext http.
    expect(isLocalDomain("notlocalhost.com")).toBe(false);
    expect(isLocalDomain("localhost.evil.com")).toBe(false);
    expect(isLocalDomain("mylocalhost.io")).toBe(false);
    expect(isLocalDomain("affiliates.instantgradient.com")).toBe(false);
  });
});

describe("originFor", () => {
  it("keeps the port and adds no trailing slash", () => {
    expect(originFor("localhost:3600")).toBe("http://localhost:3600");
    expect(originFor("affiliates.instantgradient.com")).toBe(
      "https://affiliates.instantgradient.com"
    );
  });
});
