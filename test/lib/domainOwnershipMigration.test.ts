// Destructive: clears Merchant and Owner. Runs against the scratch
// DATABASE_URL that test/setup.ts enforces, never the dev one.
//
// Products that existed before domain ownership proof must keep their domains
// after the upgrade, on a build that requires proof as much as on one that
// does not. The migration marks every existing domain proven.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { readFileSync } from "node:fs";
import { db } from "@/lib/db";

const MIGRATION = "prisma/migrations/20261116090000_domain_ownership/migration.sql";

async function clear() {
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("domain ownership migration", () => {
  beforeEach(clear);
  afterAll(async () => {
    await clear();
    await db.$disconnect();
  });

  it("marks every existing domain proven and leaves one already proven as it was", async () => {
    const owner = await db.owner.create({ data: { email: "owner@example.com", passwordHash: "x" } });
    const product = (domain: string, domainVerifiedAt: Date | null) =>
      db.merchant.create({
        data: { slug: domain, ownerId: owner.id, name: domain, domain, websiteUrl: "https://example.com", domainVerifiedAt },
      });
    const before = await product("old.example.com", null);
    const provenAt = new Date("2026-01-01T00:00:00Z");
    const proven = await product("proven.example.com", provenAt);

    // The data step only: the columns it adds already exist here.
    const updates = readFileSync(MIGRATION, "utf8").match(/^UPDATE [^;]+;/gm);
    expect(updates).toHaveLength(1);
    await db.$executeRawUnsafe(updates![0]);

    const after = await db.merchant.findUniqueOrThrow({ where: { id: before.id } });
    expect(after.domainVerifiedAt).not.toBeNull();
    expect(after.domainToken).toBeNull();
    expect((await db.merchant.findUniqueOrThrow({ where: { id: proven.id } })).domainVerifiedAt).toEqual(provenAt);
  });
});
