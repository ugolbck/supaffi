// Destructive: clears WebhookEvent / Merchant / Owner and the rows between.
// Runs against the scratch DATABASE_URL that test/setup.ts enforces.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  cleanupProcessedEvents,
  runDailyCleanup,
  resetCleanupSchedule,
  type CleanupDeps,
} from "@/lib/worker/cleanup";
import { webhookEventReceived } from "@/lib/checks/stripe";
import { getTrackingStatus } from "@/lib/tracking";

const DAY = 24 * 60 * 60_000;
const NOW = new Date("2026-09-13T12:00:00Z");
const ago = (days: number) => new Date(NOW.getTime() - days * DAY);

async function clearAll() {
  await db.webhookEvent.deleteMany();
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  // Release 3 added a foreign key from ReferredSubscription to Click, so it
  // has to go first.
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedMerchant() {
  const owner = await db.owner.create({
    data: { email: `cleanup-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
  const merchant = await db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "Cleanup",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://example.com",
      trackingVerifiedAt: ago(200),
    },
  });
  return { ownerId: owner.id, merchant };
}

function row(merchantId: string, status: "PENDING" | "PROCESSING" | "PROCESSED" | "FAILED", createdAt: Date) {
  return db.webhookEvent.create({
    data: { merchantId, stripeEventId: `evt_${crypto.randomUUID()}`, payload: {}, status, createdAt },
  });
}

describe("cleanupProcessedEvents", () => {
  beforeEach(clearAll);

  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("deletes only processed events older than 90 days", async () => {
    const { merchant } = await seedMerchant();
    const old1 = await row(merchant.id, "PROCESSED", ago(120));
    const old2 = await row(merchant.id, "PROCESSED", ago(91));
    const recent = await row(merchant.id, "PROCESSED", ago(10));
    const failed = await row(merchant.id, "FAILED", ago(150));
    const pending = await row(merchant.id, "PENDING", ago(150));
    const processing = await row(merchant.id, "PROCESSING", ago(150));

    expect(await cleanupProcessedEvents(NOW)).toBe(2);

    const left = (await db.webhookEvent.findMany({ select: { id: true } })).map((r) => r.id).sort();
    expect(left).toEqual([recent.id, failed.id, pending.id, processing.id].sort());
    expect(left).not.toContain(old1.id);
    expect(left).not.toContain(old2.id);
  });

  it("keeps each product's newest event so it still reads as receiving events", async () => {
    const { ownerId, merchant } = await seedMerchant();
    await row(merchant.id, "PROCESSED", ago(300));
    const newest = await row(merchant.id, "PROCESSED", ago(200));

    expect(await cleanupProcessedEvents(NOW)).toBe(1);

    expect((await db.webhookEvent.findMany()).map((r) => r.id)).toEqual([newest.id]);
    expect((await webhookEventReceived(ownerId, merchant.id)).ok).toBe(true);
  });

  it("keeps a quiet product's only event when another product has newer ones", async () => {
    const { merchant: merchantA } = await seedMerchant();
    const { ownerId: ownerIdB, merchant: merchantB } = await seedMerchant();
    await row(merchantA.id, "PROCESSED", ago(300));
    const newestA = await row(merchantA.id, "PROCESSED", ago(200));
    const onlyB = await row(merchantB.id, "PROCESSED", ago(250));

    expect(await cleanupProcessedEvents(NOW)).toBe(1);

    const left = (await db.webhookEvent.findMany({ select: { id: true } })).map((r) => r.id).sort();
    expect(left).toEqual([newestA.id, onlyB.id].sort());
    expect((await webhookEventReceived(ownerIdB, merchantB.id)).ok).toBe(true);
  });

  it("works through a large backlog in batches", async () => {
    const { merchant } = await seedMerchant();
    for (let i = 0; i < 5; i++) await row(merchant.id, "PROCESSED", ago(100 + i));
    await row(merchant.id, "PROCESSED", ago(1));

    expect(await cleanupProcessedEvents(NOW, { batchSize: 2 })).toBe(5);
    expect(await db.webhookEvent.count()).toBe(1);
  });

  it("never touches a product's tracking state", async () => {
    const { merchant } = await seedMerchant();
    await row(merchant.id, "PROCESSED", ago(120));
    await row(merchant.id, "PROCESSED", ago(1));

    await cleanupProcessedEvents(NOW);

    const after = await db.merchant.findUniqueOrThrow({ where: { id: merchant.id } });
    expect(after.trackingVerifiedAt?.getTime()).toBe(merchant.trackingVerifiedAt?.getTime());
    expect(await getTrackingStatus(merchant.id)).toBe("verified");
  });
});

describe("runDailyCleanup", () => {
  function deps(overrides: Partial<CleanupDeps> = {}) {
    let clock = 1_000_000;
    const cleanup = vi.fn(async () => 0);
    const d = {
      cleanup,
      now: () => clock,
      advance: (ms: number) => {
        clock += ms;
      },
      ...overrides,
    };
    return d;
  }

  beforeEach(() => {
    resetCleanupSchedule();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  it("runs on the first tick, not again the same day, and again a day later", async () => {
    const d = deps();
    await runDailyCleanup(d);
    d.advance(5_000);
    await runDailyCleanup(d);
    expect(d.cleanup).toHaveBeenCalledTimes(1);
    d.advance(DAY);
    await runDailyCleanup(d);
    expect(d.cleanup).toHaveBeenCalledTimes(2);
  });

  it("never runs twice at once", async () => {
    let release: (value: number) => void = () => {};
    const d = deps({
      cleanup: vi.fn(
        () =>
          new Promise<number>((resolve) => {
            release = resolve;
          })
      ),
    });
    const first = runDailyCleanup(d);
    await runDailyCleanup(d);
    expect(d.cleanup).toHaveBeenCalledTimes(1);
    release(0);
    await first;
  });

  it("never throws, and a failed run waits a day rather than repeating every tick", async () => {
    const d = deps({
      cleanup: vi.fn(async () => {
        throw new Error("database down");
      }),
    });
    await expect(runDailyCleanup(d)).resolves.toBeUndefined();
    d.advance(5_000);
    await runDailyCleanup(d);
    expect(d.cleanup).toHaveBeenCalledTimes(1);
  });
});
