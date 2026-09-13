import { describe, it, expect, beforeEach } from "vitest";
import {
  reserveLoginRequest,
  reserveLoginAttempt,
  clearLoginAttempts,
  resetLoginThrottle,
} from "@/lib/loginThrottle";

const PER_ADDRESS = 10;
const PER_EMAIL = 100;
const WINDOW_MS = 15 * 60 * 1000;
const T0 = 1_700_000_000_000;
const OWNER = "owner@example.com";

beforeEach(() => {
  resetLoginThrottle();
});

function attempt(times: number, address = "203.0.113.1", at = T0, email = OWNER): void {
  for (let i = 0; i < times; i += 1) reserveLoginAttempt(email, address, at);
}

describe("reserveLoginAttempt", () => {
  it("allows the first attempt", () => {
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(true);
  });

  it("allows up to the limit and refuses the next one", () => {
    attempt(PER_ADDRESS - 1);
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(true);
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(false);
  });

  it("counts before the hash, so a concurrent burst cannot all get through", () => {
    // Every request in a burst reserves before any of their hashes finish.
    // Counting only after a failure would let all of them pass the check.
    const results = Array.from({ length: 500 }, () =>
      reserveLoginAttempt(OWNER, "203.0.113.1", T0)
    );
    expect(results.filter(Boolean)).toHaveLength(PER_ADDRESS);
  });
});

describe("the window", () => {
  it("still refuses just before it expires", () => {
    attempt(PER_ADDRESS);
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0 + WINDOW_MS - 1)).toBe(false);
  });

  it("allows again once it has passed", () => {
    attempt(PER_ADDRESS);
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0 + WINDOW_MS)).toBe(true);
  });
});

describe("a successful login", () => {
  it("clears the count for that address", () => {
    attempt(PER_ADDRESS);
    clearLoginAttempts(OWNER, "203.0.113.1");
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(true);
  });
});

describe("lockout", () => {
  it("does not lock the Owner out when a stranger hits the limit", () => {
    attempt(PER_ADDRESS, "198.51.100.7");
    expect(reserveLoginAttempt(OWNER, "198.51.100.7", T0)).toBe(false);
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(true);
  });

  it("still caps the email when the address keeps changing", () => {
    // A made-up forwarded address per batch must not add up to unlimited
    // guesses.
    for (let i = 0; i < PER_EMAIL; i += 1) {
      expect(reserveLoginAttempt(OWNER, `10.0.${Math.floor(i / 10)}.1`, T0)).toBe(true);
    }
    expect(reserveLoginAttempt(OWNER, "192.0.2.99", T0)).toBe(false);
  });

  it("keeps the email cap when a flood of addresses evicts address entries", () => {
    for (let i = 0; i < 5000; i += 1) reserveLoginAttempt(OWNER, `flood-${i}`, T0);
    expect(reserveLoginAttempt(OWNER, "192.0.2.99", T0)).toBe(false);
  });
});

describe("keying", () => {
  it("treats case and surrounding space as the same email", () => {
    attempt(PER_ADDRESS, "203.0.113.1", T0, "Owner@Example.com");
    expect(reserveLoginAttempt("  owner@example.com  ", "203.0.113.1", T0)).toBe(false);
  });

  it("clears case-insensitively too", () => {
    attempt(PER_ADDRESS);
    clearLoginAttempts("OWNER@EXAMPLE.COM", "203.0.113.1");
    expect(reserveLoginAttempt(OWNER, "203.0.113.1", T0)).toBe(true);
  });
});

describe("reserveLoginRequest", () => {
  const PER_CLIENT = 20;

  it("allows twenty requests an address in the window, then refuses", () => {
    for (let i = 0; i < PER_CLIENT; i += 1) {
      expect(reserveLoginRequest("203.0.113.1", T0)).toBe(true);
    }
    expect(reserveLoginRequest("203.0.113.1", T0)).toBe(false);
    expect(reserveLoginRequest("203.0.113.2", T0)).toBe(true);
    expect(reserveLoginRequest("203.0.113.1", T0 + WINDOW_MS)).toBe(true);
  });

  it("never limits a missing or private address, which every visitor would share", () => {
    for (let i = 0; i < PER_CLIENT * 5; i += 1) {
      expect(reserveLoginRequest(null, T0)).toBe(true);
      expect(reserveLoginRequest("172.18.0.1", T0)).toBe(true);
      expect(reserveLoginRequest("::1", T0)).toBe(true);
    }
  });
});
