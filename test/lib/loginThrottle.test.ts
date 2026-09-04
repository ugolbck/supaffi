import { describe, it, expect, beforeEach } from "vitest";
import {
  checkLoginAllowed,
  recordFailedLogin,
  clearLoginFailures,
  resetLoginThrottle,
} from "@/lib/loginThrottle";

const MAX_FAILURES = 10;
const WINDOW_MS = 15 * 60 * 1000;
const T0 = 1_700_000_000_000;

beforeEach(() => {
  resetLoginThrottle();
});

function fail(email: string, times: number, at = T0): void {
  for (let i = 0; i < times; i += 1) recordFailedLogin(email, at);
}

describe("checkLoginAllowed", () => {
  it("allows an email nobody has failed on", () => {
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(true);
  });

  it("stays allowed while under the limit", () => {
    fail("owner@example.com", MAX_FAILURES - 1);
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(true);
  });

  it("refuses once the limit is reached", () => {
    fail("owner@example.com", MAX_FAILURES);
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(false);
  });

  it("stays refused as failures keep arriving", () => {
    fail("owner@example.com", MAX_FAILURES + 5);
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(false);
  });
});

describe("the window", () => {
  it("still refuses just before it expires", () => {
    fail("owner@example.com", MAX_FAILURES);
    expect(checkLoginAllowed("owner@example.com", T0 + WINDOW_MS - 1)).toBe(false);
  });

  it("allows again once it has passed", () => {
    fail("owner@example.com", MAX_FAILURES);
    expect(checkLoginAllowed("owner@example.com", T0 + WINDOW_MS)).toBe(true);
  });

  it("starts a fresh window rather than resuming the old count", () => {
    fail("owner@example.com", MAX_FAILURES);
    const later = T0 + WINDOW_MS;
    // One failure in the new window, not the eleventh in the old one.
    fail("owner@example.com", 1, later);
    expect(checkLoginAllowed("owner@example.com", later)).toBe(true);
  });
});

describe("a successful login", () => {
  it("clears the count", () => {
    fail("owner@example.com", MAX_FAILURES);
    clearLoginFailures("owner@example.com");
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(true);
  });
});

describe("keying", () => {
  it("gives each email its own budget", () => {
    fail("owner@example.com", MAX_FAILURES);
    expect(checkLoginAllowed("someone@example.com", T0)).toBe(true);
  });

  it("treats case and surrounding space as the same email", () => {
    // Otherwise Bob@x.com and bob@x.com are two budgets for one account, and
    // the limit is trivially bypassed by changing the capitalisation.
    fail("Owner@Example.com", MAX_FAILURES);
    expect(checkLoginAllowed("  owner@example.com  ", T0)).toBe(false);
  });

  it("clears case-insensitively too", () => {
    fail("owner@example.com", MAX_FAILURES);
    clearLoginFailures("OWNER@EXAMPLE.COM");
    expect(checkLoginAllowed("owner@example.com", T0)).toBe(true);
  });
});

describe("memory", () => {
  it("stops growing, so the throttle is not itself the exhaustion", () => {
    // The map is keyed by an attacker-supplied string. Without a cap, sending
    // distinct emails is a cheaper way to fill memory than the Argon2 hashing
    // this module exists to gate.
    for (let i = 0; i < 5000; i += 1) {
      recordFailedLogin(`flood-${i}@example.com`, T0 + i);
    }
    // The oldest were evicted, so an early key is allowed again.
    expect(checkLoginAllowed("flood-0@example.com", T0)).toBe(true);
    // The newest are still tracked, which is what the cap must not cost.
    fail("flood-4999@example.com", MAX_FAILURES - 1, T0 + 4999);
    expect(checkLoginAllowed("flood-4999@example.com", T0 + 4999)).toBe(false);
  });
});
