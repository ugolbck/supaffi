import { describe, it, expect, beforeEach } from "vitest";
import { reservePasswordLink, resetPasswordLinkThrottle } from "@/lib/passwordLinkThrottle";

describe("password link throttle", () => {
  beforeEach(resetPasswordLinkThrottle);

  it("lets an account ask three times an hour", () => {
    const now = Date.now();
    const asks = [0, 1, 2, 3].map(() => reservePasswordLink("m1", "a@example.com", "203.0.113.5", now));
    expect(asks).toEqual([true, true, true, false]);
    expect(reservePasswordLink("m1", "a@example.com", "203.0.113.5", now + 61 * 60 * 1000)).toBe(true);
  });

  it("caps one address across many accounts", () => {
    const now = Date.now();
    const asks = Array.from({ length: 11 }, (_, i) => reservePasswordLink("m1", `a${i}@example.com`, "203.0.113.5", now));
    expect(asks.filter(Boolean)).toHaveLength(10);
    // A private address means the proxy did not pass the visitor's on.
    expect(reservePasswordLink("m1", "b@example.com", "10.0.0.1", now)).toBe(true);
  });
});
