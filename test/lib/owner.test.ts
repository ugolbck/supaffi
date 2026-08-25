import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createOwner, ownerExists, verifyOwnerCredentials } from "@/lib/owner";

beforeEach(async () => {
  await db.owner.deleteMany();
});

afterAll(async () => {
  await db.owner.deleteMany();
  await db.$disconnect();
});

describe("owner", () => {
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
