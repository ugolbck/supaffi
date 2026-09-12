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
  it("has no token before one is minted", async () => {
    expect(setupTokenExists()).toBe(false);
  });

  it("accepts the token it minted", async () => {
    const token = mintSetupToken();
    expect(await verifySetupToken(token)).toBe(true);
  });

  it("reports that a token exists once minted", async () => {
    mintSetupToken();
    expect(setupTokenExists()).toBe(true);
  });

  it("rejects a different token of the same length", async () => {
    const token = mintSetupToken();
    const other = token.slice(0, -1) + (token.endsWith("a") ? "b" : "a");
    expect(await verifySetupToken(other)).toBe(false);
  });

  it("rejects a candidate of a different length without throwing", async () => {
    mintSetupToken();
    expect(await verifySetupToken("short")).toBe(false);
  });

  it("rejects an empty candidate", async () => {
    mintSetupToken();
    expect(await verifySetupToken("")).toBe(false);
  });

  // The state after setup completes, and also the state if the startup hook
  // could not reach the database to decide whether a token was needed.
  it("fails closed when no token is held, whatever is presented", async () => {
    expect(await verifySetupToken("anything")).toBe(false);
    expect(await verifySetupToken("")).toBe(false);
  });

  it("stops accepting a token once cleared", async () => {
    const token = mintSetupToken();
    clearSetupToken();
    expect(await verifySetupToken(token)).toBe(false);
  });

  it("replaces the previous token when minted again, so a restart invalidates the old one", async () => {
    const first = mintSetupToken();
    const second = mintSetupToken();
    expect(first).not.toBe(second);
    expect(await verifySetupToken(first)).toBe(false);
    expect(await verifySetupToken(second)).toBe(true);
  });

  it("mints a URL-safe token long enough not to be guessed", () => {
    const token = mintSetupToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]{32,}$/);
  });
});
