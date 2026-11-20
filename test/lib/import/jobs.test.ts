// Destructive: clears the import's tables. Runs against the scratch
// DATABASE_URL that test/setup.ts enforces.
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { confirmImport, runImports, startImport } from "@/lib/import/jobs";

async function clearAll() {
  await db.commission.deleteMany();
  await db.payout.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.import.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

const EMPTY = { pagination: { next_page: null }, data: [] };

function rewardful(status = 200) {
  vi.stubGlobal("fetch", async (input: string) => {
    if (status !== 200) return new Response("no", { status });
    const path = new URL(input).pathname;
    if (path.endsWith("/affiliates")) {
      return Response.json({
        pagination: { next_page: null },
        data: [{ id: "a1", email: "sarah@example.com", first_name: "Sarah", last_name: null, paypal_email: null, campaign: { id: "c1" }, links: [{ token: "sarah" }] }],
      });
    }
    if (path.endsWith("/campaigns")) return Response.json({ pagination: { next_page: null }, data: [{ id: "c1", name: "Main" }] });
    return Response.json(EMPTY);
  });
}

describe("import jobs", () => {
  let ownerId: string;
  let merchantId: string;
  let programId: string;

  beforeEach(async () => {
    await clearAll();
    ownerId = (await db.owner.create({ data: { email: `o-${crypto.randomUUID()}@example.com`, passwordHash: "x" } })).id;
    merchantId = (
      await db.merchant.create({ data: { slug: "shop", ownerId, name: "Shop", domain: `${crypto.randomUUID()}.example.com`, websiteUrl: "https://x.example.com" } })
    ).id;
    programId = (
      await db.program.create({ data: { merchantId, slug: "p", name: "P", defaultCommissionRate: 20, commissionDurationType: "FOREVER" } })
    ).id;
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("keeps the key only until the program is read, then writes it on the owner's go", async () => {
    rewardful();
    const started = await startImport(ownerId, merchantId, "REWARDFUL", " sk_live_secret ", null);
    if (started.error !== null) throw new Error(started.error);
    const stored = await db.import.findUniqueOrThrow({ where: { id: started.id } });
    expect(stored.apiKeyEnc).not.toBeNull();
    expect(stored.apiKeyEnc).not.toContain("sk_live_secret");

    await runImports();
    const read = await db.import.findUniqueOrThrow({ where: { id: started.id } });
    expect(read.status).toBe("READY");
    expect(read.apiKeyEnc).toBeNull();
    expect(await db.affiliate.count()).toBe(0);

    expect(await confirmImport(ownerId, merchantId, started.id, { c1: programId, c2: "someone-elses" })).toBe(true);
    expect((await db.import.findUniqueOrThrow({ where: { id: started.id } })).mapping).toEqual({ c1: programId });
    await runImports();
    const done = await db.import.findUniqueOrThrow({ where: { id: started.id } });
    expect(done.status).toBe("DONE");
    // What was read held every affiliate's email; only the summary stays.
    expect(done.fetched).toBeNull();
    expect(await db.affiliateLink.findUnique({ where: { code: "sarah" } })).not.toBeNull();
  });

  it("fails with the tool's refusal and forgets the key", async () => {
    rewardful(401);
    const started = await startImport(ownerId, merchantId, "REWARDFUL", "wrong", null);
    if (started.error !== null) throw new Error(started.error);
    await runImports();
    expect(await db.import.findUniqueOrThrow({ where: { id: started.id } })).toMatchObject({
      status: "FAILED",
      error: "Rewardful refused the API key. Check it and start again.",
      apiKeyEnc: null,
    });
  });

  it("asks FirstPromoter for its account id, and runs one import at a time", async () => {
    expect(await startImport(ownerId, merchantId, "FIRSTPROMOTER", "key", null)).toEqual({ error: "Paste the account ID too." });
    expect(await startImport(ownerId, merchantId, "FIRSTPROMOTER", "key", "acc", "dollars")).toEqual({
      error: "Enter the account's currency, like USD.",
    });
    expect((await startImport(ownerId, merchantId, "TOLT", "key", null)).error).toBeNull();
    expect(await startImport(ownerId, merchantId, "TOLT", "key", null)).toEqual({ error: "An import is already running on this product." });
  });

  it("refuses another owner's product", async () => {
    const stranger = (await db.owner.create({ data: { email: `s-${crypto.randomUUID()}@example.com`, passwordHash: "x" } })).id;
    await expect(startImport(stranger, merchantId, "TOLT", "key", null)).rejects.toThrow();
  });

  it("fails a job that keeps stopping the worker instead of taking it forever", async () => {
    rewardful();
    const started = await startImport(ownerId, merchantId, "REWARDFUL", "key", null);
    if (started.error !== null) throw new Error(started.error);
    await db.import.update({ where: { id: started.id }, data: { attempts: 3 } });
    await runImports();
    expect(await db.import.findUniqueOrThrow({ where: { id: started.id } })).toMatchObject({ status: "FAILED", apiKeyEnc: null });
  });
});
