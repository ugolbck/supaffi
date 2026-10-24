import { describe, it, expect, beforeEach } from "vitest";
import { reserveAffiliateSignup, resetAffiliateSignupThrottle } from "@/lib/affiliateSignupThrottle";

const PER_ADDRESS_HOUR = 20;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetAffiliateSignupThrottle();
});

describe("reserveAffiliateSignup", () => {
  it("allows up to the limit from one address on one product and refuses the next", () => {
    for (let i = 0; i < PER_ADDRESS_HOUR; i += 1) {
      expect(reserveAffiliateSignup("merchant-a", "203.0.113.1", T0)).toBe(true);
    }
    expect(reserveAffiliateSignup("merchant-a", "203.0.113.1", T0)).toBe(false);
  });

  it("counts each address and each product on its own", () => {
    for (let i = 0; i < PER_ADDRESS_HOUR; i += 1) reserveAffiliateSignup("merchant-a", "203.0.113.1", T0);
    expect(reserveAffiliateSignup("merchant-a", "203.0.113.2", T0)).toBe(true);
    expect(reserveAffiliateSignup("merchant-b", "203.0.113.1", T0)).toBe(true);
  });

  it("allows the address again once the hour is over", () => {
    for (let i = 0; i < PER_ADDRESS_HOUR; i += 1) reserveAffiliateSignup("merchant-a", "203.0.113.1", T0);
    expect(reserveAffiliateSignup("merchant-a", "203.0.113.1", T0 + 60 * 60 * 1000)).toBe(true);
  });

  it("never limits a private or missing address, which is the proxy rather than a visitor", () => {
    for (let i = 0; i < PER_ADDRESS_HOUR * 3; i += 1) {
      expect(reserveAffiliateSignup("merchant-a", "172.18.0.3", T0)).toBe(true);
      expect(reserveAffiliateSignup("merchant-a", null, T0)).toBe(true);
    }
  });
});
