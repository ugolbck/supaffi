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
});
