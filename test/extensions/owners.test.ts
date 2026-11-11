// Destructive: clears the Owner table. Runs only against a database whose
// name ends in _test (see test/setup.ts).
//
// The first-run wizard and its one Owner are this app's default. A build that
// sets owners.signupPath opens the instance to several Owners instead.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

async function ownerModuleWith(signupPath: string | null) {
  vi.resetModules();
  vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { owners: { signupPath } } }));
  return import("@/lib/owner");
}

describe.skipIf(!hasDatabase)("Owner creation", () => {
  beforeEach(async () => {
    await db.owner.deleteMany();
  });

  afterAll(async () => {
    vi.doUnmock("@/extensions/installed-static");
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("refuses a second Owner by default", async () => {
    const { createOwner } = await ownerModuleWith(null);
    await createOwner("first@example.com", "correct horse battery staple");
    await expect(createOwner("second@example.com", "correct horse battery staple")).rejects.toThrow(
      "An Owner already exists on this Instance"
    );
  });

  it("allows several Owners once signup is open", async () => {
    const { createOwner } = await ownerModuleWith("/signup");
    await createOwner("first@example.com", "correct horse battery staple");
    await createOwner("second@example.com", "correct horse battery staple");
    expect(await db.owner.count()).toBe(2);
  });

  it("still refuses an email that is taken", async () => {
    const { createOwner } = await ownerModuleWith("/signup");
    await createOwner("first@example.com", "correct horse battery staple");
    await expect(createOwner("FIRST@example.com", "correct horse battery staple")).rejects.toThrow();
  });
});
