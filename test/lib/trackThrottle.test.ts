import { describe, it, expect, beforeEach } from "vitest";
import { isClickLimited, rememberClick, resetTrackThrottle } from "@/lib/trackThrottle";
import { isPrivateAddress } from "@/lib/clientAddress";

const T0 = 1_700_000_000_000;
const TEN_MINUTES = 10 * 60 * 1000;
const MAX_NEW_CLICKS_PER_ADDRESS = 30;
const VISITOR = "203.0.113.7";

beforeEach(() => {
  resetTrackThrottle();
});

describe("isClickLimited", () => {
  it("lets a first click through", () => {
    expect(isClickLimited(VISITOR, T0)).toBe(false);
  });

  it("stops one address after too many new clicks, until the window passes", () => {
    for (let i = 0; i < MAX_NEW_CLICKS_PER_ADDRESS; i++) rememberClick(VISITOR, T0);
    expect(isClickLimited(VISITOR, T0)).toBe(true);
    expect(isClickLimited("198.51.100.4", T0)).toBe(false);
    expect(isClickLimited(VISITOR, T0 + TEN_MINUTES)).toBe(false);
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
