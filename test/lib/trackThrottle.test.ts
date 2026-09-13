import { describe, it, expect, beforeEach } from "vitest";
import {
  decideClick,
  rememberClick,
  forgetClick,
  resetTrackThrottle,
} from "@/lib/trackThrottle";
import { isPrivateAddress } from "@/lib/clientAddress";

const T0 = 1_700_000_000_000;
const TEN_MINUTES = 10 * 60 * 1000;
const MAX_NEW_CLICKS_PER_ADDRESS = 30;
const VISITOR = "203.0.113.7";

beforeEach(() => {
  resetTrackThrottle();
});

describe("decideClick", () => {
  it("lets a first click through", () => {
    expect(decideClick(VISITOR, "sarah", T0)).toEqual({ kind: "new" });
  });

  it("hands a repeat of the same code the token it already got", () => {
    rememberClick(VISITOR, "sarah", "token-1", T0);
    expect(decideClick(VISITOR, "sarah", T0 + 1000)).toEqual({
      kind: "reuse",
      referralToken: "token-1",
    });
  });

  it("gives a different address or code its own click", () => {
    rememberClick(VISITOR, "sarah", "token-1", T0);
    expect(decideClick("198.51.100.4", "sarah", T0)).toEqual({ kind: "new" });
    expect(decideClick(VISITOR, "bob", T0)).toEqual({ kind: "new" });
  });

  it("records a new click once the dedupe window has passed", () => {
    rememberClick(VISITOR, "sarah", "token-1", T0);
    expect(decideClick(VISITOR, "sarah", T0 + TEN_MINUTES)).toEqual({ kind: "new" });
  });

  it("stops one address cycling through codes", () => {
    for (let i = 0; i < MAX_NEW_CLICKS_PER_ADDRESS; i++) {
      rememberClick(VISITOR, `code-${i}`, `token-${i}`, T0);
    }
    expect(decideClick(VISITOR, "one-more", T0)).toEqual({ kind: "limited" });
    // A code it already has still gets its token back rather than an error.
    expect(decideClick(VISITOR, "code-0", T0)).toEqual({ kind: "reuse", referralToken: "token-0" });
    expect(decideClick(VISITOR, "one-more", T0 + TEN_MINUTES)).toEqual({ kind: "new" });
  });

  it("forgets a click whose row was never written", () => {
    rememberClick(VISITOR, "sarah", "token-1", T0);
    forgetClick(VISITOR, "sarah", "token-1");
    expect(decideClick(VISITOR, "sarah", T0)).toEqual({ kind: "new" });
  });
});

describe("isPrivateAddress", () => {
  it("recognizes loopback, Docker and link-local addresses", () => {
    for (const address of [
      "127.0.0.1",
      "10.0.0.5",
      "172.18.0.3",
      "192.168.1.20",
      "169.254.1.1",
      "::1",
      "::ffff:172.18.0.3",
      "fd00::1",
      "fe80::1",
    ]) {
      expect(isPrivateAddress(address), address).toBe(true);
    }
  });

  it("treats internet addresses as public", () => {
    for (const address of ["203.0.113.7", "8.8.8.8", "172.32.0.1", "2001:db8::1"]) {
      expect(isPrivateAddress(address), address).toBe(false);
    }
  });
});
