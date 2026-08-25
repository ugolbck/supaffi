// Destructive: runs db.owner.deleteMany() before/after every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createOwner, ownerExists, verifyOwnerCredentials } from "@/lib/owner";

// Skip this whole suite cleanly when no database is reachable, instead of
// letting Prisma throw an opaque connection error mid-run. Checked once,
// up front, via a real connection attempt (not just "is DATABASE_URL set")
// so a stale/unreachable URL also skips rather than failing the suite.
let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

if (!hasDatabase) {
  // eslint-disable-next-line no-console
  console.warn(
    "Skipping test/lib/owner.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("owner", () => {
  beforeEach(async () => {
    await db.owner.deleteMany();
  });

  afterAll(async () => {
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("reports no Owner exists on a fresh Instance", async () => {
    expect(await ownerExists()).toBe(false);
  });

  it("creates the Owner and reports it exists afterward", async () => {
    await createOwner("ugo@example.com", "correct horse battery staple");
    expect(await ownerExists()).toBe(true);
  });

  it("refuses to create a second Owner", async () => {
    await createOwner("ugo@example.com", "correct horse battery staple");
    await expect(createOwner("someone-else@example.com", "another password")).rejects.toThrow(
      "An Owner already exists on this Instance"
    );
  });

  it("verifies correct credentials and rejects incorrect ones", async () => {
    await createOwner("ugo@example.com", "correct horse battery staple");
    const ok = await verifyOwnerCredentials("ugo@example.com", "correct horse battery staple");
    expect(ok?.email).toBe("ugo@example.com");

    const bad = await verifyOwnerCredentials("ugo@example.com", "wrong password");
    expect(bad).toBeNull();

    const noSuchUser = await verifyOwnerCredentials("nobody@example.com", "anything");
    expect(noSuchUser).toBeNull();
  });

  it("prevents race condition: concurrent createOwner calls serialize correctly", async () => {
    // Call createOwner twice concurrently with different emails
    const results = await Promise.allSettled([
      createOwner("alice@example.com", "password1"),
      createOwner("bob@example.com", "password2"),
    ]);

    // Exactly one should succeed, one should fail
    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);

    // The rejected one should have the correct error
    const rejectedError = rejected[0];
    if (rejectedError.status === "rejected") {
      expect(rejectedError.reason).toBeInstanceOf(Error);
      expect(rejectedError.reason.message).toBe("An Owner already exists on this Instance");
    }

    // Verify only one Owner exists in the database
    const count = await db.owner.count();
    expect(count).toBe(1);
  });
});
