// The Owner login path without a database: the lookup and the Argon2 calls are
// mocked, so what is checked is which calls happen, not what they return.
import { describe, it, expect, vi, beforeEach } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ db: { owner: { findUnique } } }));

const hashPassword = vi.fn(async () => "dummy-hash");
const verifyPassword = vi.fn(async (_plain: string, _hashed: string): Promise<boolean> => false);
const { ConcurrencyLimitError } = await vi.importActual<typeof import("@/lib/password")>(
  "@/lib/password"
);
// The no-account verify and its dummy hash live in password.ts, and are
// covered there. Here it only has to run a verify, so the failures below
// travel through it the way they do in the real thing.
const verifyAgainstNoAccount = vi.fn(async (plain: string): Promise<false> => {
  await verifyPassword(plain, "dummy-hash");
  return false;
});
vi.mock("@/lib/password", () => ({ hashPassword, verifyPassword, verifyAgainstNoAccount, ConcurrencyLimitError }));

const { checkOwnerPassword, findOwnerForLogin, verifyOwnerCredentials } = await import(
  "@/lib/owner"
);

beforeEach(() => {
  findUnique.mockReset();
  verifyPassword.mockClear();
  verifyAgainstNoAccount.mockClear();
});

describe("owner login timing", () => {
  it("still runs a verify for an email that is not the Owner's", async () => {
    // Returning before the hash would answer a wrong email far faster than the
    // right one, which gives the Owner's email away.
    findUnique.mockResolvedValue(null);
    expect(await verifyOwnerCredentials("nobody@example.com", "guess")).toBeNull();
    expect(verifyAgainstNoAccount).toHaveBeenCalledWith("guess");
    expect(verifyPassword).toHaveBeenCalledWith("guess", "dummy-hash");
  });

  it("verifies against the Owner's own hash when the email matches", async () => {
    const owner = { id: "o1", email: "owner@example.com", passwordHash: "real-hash" };
    verifyPassword.mockResolvedValueOnce(true);
    expect(await checkOwnerPassword(owner, "right")).toEqual({ id: "o1", email: "owner@example.com" });
    expect(verifyPassword).toHaveBeenCalledWith("right", "real-hash");
  });

  it("answers incorrect rather than erroring when the Argon2 queue is full", async () => {
    const owner = { id: "o1", email: "owner@example.com", passwordHash: "real-hash" };
    verifyPassword.mockRejectedValueOnce(new ConcurrencyLimitError());
    expect(await checkOwnerPassword(owner, "right")).toBeNull();
    verifyPassword.mockRejectedValueOnce(new ConcurrencyLimitError());
    expect(await checkOwnerPassword(null, "guess")).toBeNull();
  });

  it("still throws any other failure", async () => {
    verifyPassword.mockRejectedValueOnce(new Error("boom"));
    await expect(checkOwnerPassword(null, "guess")).rejects.toThrow("boom");
  });

  it("looks the Owner up by normalized email", async () => {
    findUnique.mockResolvedValue(null);
    await findOwnerForLogin("  Owner@Example.com ");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "owner@example.com" } })
    );
  });
});
