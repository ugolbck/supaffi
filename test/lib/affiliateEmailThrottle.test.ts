import { describe, it, expect, beforeEach } from "vitest";
import {
  reserveAffiliateEmail,
  resetAffiliateEmailThrottle,
} from "@/lib/affiliateEmailThrottle";

const T0 = 1_700_000_000_000;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

beforeEach(() => {
  resetAffiliateEmailThrottle();
});

describe("reserveAffiliateEmail", () => {
  it("sends one email a minute to the same recipient", () => {
    expect(reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0)).toBe(true);
    expect(reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0 + 1000)).toBe(false);
    expect(reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0 + MINUTE_MS)).toBe(
      true
    );
  });

  it("has no hourly cap per recipient, so a stranger cannot spend an Affiliate's allowance", () => {
    for (let i = 0; i < 30; i += 1) {
      expect(
        reserveAffiliateEmail("m1", "sarah@example.com", `198.51.100.${i}`, T0 + i * MINUTE_MS)
      ).toBe(true);
    }
  });

  it("skips the address limit when the address is missing or private", () => {
    // Behind a proxy that does not forward the visitor, every request looks
    // like the proxy, and a shared budget would stop the whole instance's
    // signups at twenty an hour.
    for (let i = 0; i < 50; i += 1) {
      expect(reserveAffiliateEmail("m1", `a-${i}@example.com`, null, T0)).toBe(true);
      expect(reserveAffiliateEmail("m1", `b-${i}@example.com`, "172.18.0.2", T0)).toBe(true);
    }
    expect(reserveAffiliateEmail("m1", "a-0@example.com", null, T0)).toBe(false);
  });

  it("treats case and surrounding space as the same recipient", () => {
    reserveAffiliateEmail("m1", "Sarah@Example.com", "203.0.113.1", T0);
    expect(reserveAffiliateEmail("m1", " sarah@example.com ", "203.0.113.2", T0)).toBe(false);
  });

  it("keeps each Merchant's recipients separate", () => {
    reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0);
    expect(reserveAffiliateEmail("m2", "sarah@example.com", "203.0.113.1", T0)).toBe(true);
  });

  it("caps one address across many recipients", () => {
    for (let i = 0; i < 20; i += 1) {
      expect(reserveAffiliateEmail("m1", `junk-${i}@example.com`, "203.0.113.1", T0)).toBe(true);
    }
    expect(reserveAffiliateEmail("m1", "junk-20@example.com", "203.0.113.1", T0)).toBe(false);
    expect(reserveAffiliateEmail("m1", "junk-20@example.com", "203.0.113.2", T0)).toBe(true);
    expect(reserveAffiliateEmail("m1", "junk-21@example.com", "203.0.113.1", T0 + HOUR_MS)).toBe(true);
  });

  it("does not spend the other limits when one refuses", () => {
    reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0);
    // Refused on the recipient limit, so the address budget is untouched.
    for (let i = 0; i < 30; i += 1) {
      reserveAffiliateEmail("m1", "sarah@example.com", "203.0.113.1", T0);
    }
    for (let i = 0; i < 19; i += 1) {
      expect(reserveAffiliateEmail("m1", `other-${i}@example.com`, "203.0.113.1", T0)).toBe(true);
    }
  });
});
