// Destructive: clears WebhookEvent / Merchant / Owner. Runs against the
// scratch DATABASE_URL that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import type { Merchant } from "@prisma/client";

import { db } from "@/lib/db";
import { backoffMs, claimBatch, markFailed } from "@/lib/worker/claim";

async function clearAll() {
  await db.webhookEvent.deleteMany();
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

describe("claimBatch", () => {
  let merchant: Merchant;

  function event(data: { status: "PENDING" | "PROCESSING"; nextAttemptAt: Date; attempts?: number }) {
    return db.webhookEvent.create({
      data: { merchantId: merchant.id, stripeEventId: `evt_${crypto.randomUUID()}`, payload: {}, ...data },
    });
  }

  beforeEach(async () => {
    await clearAll();
    const owner = await db.owner.create({
      data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
    });
    merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "InstantGradient",
        domain: `${crypto.randomUUID()}.example.com`,
        websiteUrl: "https://instantgradient.com",
      },
    });
  });

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("picks an event left PROCESSING by a crash once its lease has run out", async () => {
    const stale = await event({ status: "PROCESSING", nextAttemptAt: new Date(Date.now() - 1000), attempts: 1 });
    const live = await event({ status: "PROCESSING", nextAttemptAt: new Date(Date.now() + 60_000), attempts: 1 });

    const claimed = await claimBatch();
    expect(claimed.map((row) => row.id)).toEqual([stale.id]);
    expect(claimed[0].attempts).toBe(2);
    // The reclaim takes a fresh lease, so the next tick leaves it alone.
    expect(claimed[0].nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: live.id } })).attempts).toBe(1);
    expect(await claimBatch()).toEqual([]);
  });

  it("fails an event that keeps taking the worker down instead of reclaiming it forever", async () => {
    const poison = await event({ status: "PROCESSING", nextAttemptAt: new Date(Date.now() - 1000), attempts: 20 });

    expect(await claimBatch()).toEqual([]);
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: poison.id } })).status).toBe("FAILED");
  });

  it("keeps retrying for about two days before giving up", async () => {
    const row = await event({ status: "PROCESSING", nextAttemptAt: new Date() });

    let total = 0;
    for (let attempts = 1; attempts < 20; attempts++) total += backoffMs(attempts);
    expect(total / 3_600_000).toBeGreaterThan(40);
    expect(total / 3_600_000).toBeLessThan(50);

    await markFailed(row.id, 19, new Error("Stripe is down"));
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("PENDING");
    await markFailed(row.id, 20, new Error("Stripe is down"));
    expect((await db.webhookEvent.findUniqueOrThrow({ where: { id: row.id } })).status).toBe("FAILED");
  });
});
