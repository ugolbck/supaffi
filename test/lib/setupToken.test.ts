import { describe, it, expect, beforeEach } from "vitest";
import {
  mintSetupToken,
  setupTokenExists,
  verifySetupToken,
  clearSetupToken,
} from "@/lib/setupToken";

beforeEach(() => {
  clearSetupToken();
});

describe("setup token", () => {
  it("has no token before one is minted", () => {
    expect(setupTokenExists()).toBe(false);
  });

  it("accepts the token it minted", () => {
    const token = mintSetupToken();
    expect(verifySetupToken(token)).toBe(true);
  });

  it("reports that a token exists once minted", () => {
    mintSetupToken();
    expect(setupTokenExists()).toBe(true);
  });

  it("rejects a different token of the same length", () => {
    const token = mintSetupToken();
    const other = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(verifySetupToken(other)).toBe(false);
  });

  it("rejects a candidate of a different length without throwing", () => {
    mintSetupToken();
    expect(verifySetupToken("short")).toBe(false);
  });

  it("rejects an empty candidate", () => {
    mintSetupToken();
    expect(verifySetupToken("")).toBe(false);
  });

  // The state after setup completes, and also the state if the startup hook
  // could not reach the database to decide whether a token was needed.
  it("fails closed when no token is held, whatever is presented", () => {
    expect(verifySetupToken("anything")).toBe(false);
    expect(verifySetupToken("")).toBe(false);
  });

  it("stops accepting a token once cleared", () => {
    const token = mintSetupToken();
    clearSetupToken();
    expect(verifySetupToken(token)).toBe(false);
  });

  it("replaces the previous token when minted again, so a restart invalidates the old one", () => {
    const first = mintSetupToken();
    const second = mintSetupToken();
    expect(first).not.toBe(second);
    expect(verifySetupToken(first)).toBe(false);
    expect(verifySetupToken(second)).toBe(true);
  });

  it("mints a URL-safe token long enough not to be guessed", () => {
    const token = mintSetupToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});
