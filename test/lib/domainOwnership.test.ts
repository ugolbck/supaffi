// Destructive: clears ReleasedDomain, Merchant and Owner before every test.
// Runs against the scratch DATABASE_URL that test/setup.ts enforces.
//
// Proof of domain ownership is off by default, and these tests switch it on
// by installing the static hook, then reload the modules that read it.
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

async function withProof(requireOwnershipProof: boolean) {
  vi.resetModules();
  vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { domains: { requireOwnershipProof } } }));
  return { ...(await import("@/lib/merchant")), ...(await import("@/lib/domainOwnership")) };
}

const DAY_MS = 24 * 60 * 60 * 1000;
const site = { name: "Docs", websiteUrl: "https://example.com" };

async function clear() {
  await db.releasedDomain.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function stored(id: string) {
  return db.merchant.findUniqueOrThrow({ where: { id }, select: { domainToken: true, domainVerifiedAt: true } });
}

/** A resolver whose TXT answer is the record the product asks for. */
async function answering(id: string) {
  const { domain, domainToken } = await db.merchant.findUniqueOrThrow({ where: { id } });
  return async (name: string) =>
    name === `_supaffi.${domain}` ? [`supaffi-verification=${domainToken}`] : [];
}

describe.skipIf(!hasDatabase)("domain ownership", () => {
  let ownerId: string;
  let otherOwnerId: string;

  beforeEach(async () => {
    await clear();
    ownerId = (await db.owner.create({ data: { email: "one@example.com", passwordHash: "x" } })).id;
    otherOwnerId = (await db.owner.create({ data: { email: "two@example.com", passwordHash: "x" } })).id;
  });

  afterAll(async () => {
    vi.doUnmock("@/extensions/installed-static");
    await clear();
    await db.$disconnect();
  });

  describe("off, as this app ships", () => {
    it("serves a new domain at once and asks for nothing", async () => {
      const m = await withProof(false);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      expect((await stored(id)).domainVerifiedAt).not.toBeNull();
      expect(await m.getMerchantByDomain("affiliates.example.com")).not.toBeNull();
      expect(await m.checkDomainOwnership(ownerId, id)).toBeNull();
    });

    it("serves a domain even when it was never marked proven", async () => {
      const m = await withProof(false);
      await db.merchant.create({ data: { ...site, ownerId, slug: "docs", domain: "affiliates.example.com" } });
      expect(await m.getMerchantByDomain("affiliates.example.com")).not.toBeNull();
    });

    it("holds nothing back when a domain is given up", async () => {
      const m = await withProof(false);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      await m.deleteMerchant(ownerId, id);
      expect(await db.releasedDomain.count()).toBe(0);
      await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
    });

    it("sets no cap on new domains", async () => {
      const m = await withProof(false);
      for (const n of [1, 2, 3, 4, 5]) await m.createMerchant(ownerId, { ...site, domain: `a${n}.example.com` });
      expect(await db.merchant.count()).toBe(5);
    });
  });

  describe("on", () => {
    it("does not serve a new domain until its TXT record is found", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      const { domainToken, domainVerifiedAt } = await stored(id);
      expect(domainVerifiedAt).toBeNull();
      expect(domainToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(await m.getMerchantByDomain("affiliates.example.com")).toBeNull();

      const check = await m.checkDomainOwnership(ownerId, id, await answering(id));
      expect(check).toEqual({
        domain: "affiliates.example.com",
        record: null,
        result: { ok: true, detail: "Verified" },
        moved: false,
      });
      expect((await stored(id)).domainVerifiedAt).not.toBeNull();
      expect(await m.getMerchantByDomain("affiliates.example.com")).not.toBeNull();
    });

    it("shows the record to create while nothing is found", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      const { domainToken } = await stored(id);
      const check = await m.checkDomainOwnership(ownerId, id, async () => {
        throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
      });
      expect(check).toEqual({
        domain: "affiliates.example.com",
        record: { name: "_supaffi.affiliates.example.com", value: `supaffi-verification=${domainToken}` },
        result: { ok: false, detail: "No record found yet" },
        moved: false,
      });
      expect((await stored(id)).domainVerifiedAt).toBeNull();
    });

    it("refuses a record with the wrong value", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      const check = await m.checkDomainOwnership(ownerId, id, async () => ["supaffi-verification=somebody-else"]);
      expect(check?.result).toEqual({ ok: false, detail: "The record has a different value" });
      expect((await stored(id)).domainVerifiedAt).toBeNull();
    });

    it("does not let one Owner check another Owner's product", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      expect(await m.checkDomainOwnership(otherOwnerId, id, await answering(id))).toBeNull();
      expect((await stored(id)).domainVerifiedAt).toBeNull();
    });

    it("needs proof again for a changed domain, and keeps a save that keeps it", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      await m.checkDomainOwnership(ownerId, id, await answering(id));

      await m.updateMerchant(ownerId, id, { ...site, name: "Renamed", domain: "affiliates.example.com" });
      expect((await stored(id)).domainVerifiedAt).not.toBeNull();

      const before = await stored(id);
      await m.updateMerchant(ownerId, id, { ...site, domain: "partners.example.com" });
      const after = await stored(id);
      expect(after.domainVerifiedAt).toBeNull();
      expect(after.domainToken).not.toBe(before.domainToken);
    });

    it("approves a local domain at once, since nothing outside can reach it", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "localhost" });
      expect((await stored(id)).domainVerifiedAt).not.toBeNull();
    });

    describe("a proven domain given up", () => {
      async function released(m: Awaited<ReturnType<typeof withProof>>, how: "delete" | "change") {
        const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
        await m.checkDomainOwnership(ownerId, id, await answering(id));
        if (how === "delete") await m.deleteMerchant(ownerId, id);
        else await m.updateMerchant(ownerId, id, { ...site, domain: "partners.example.com" });
      }

      it("is held from other Owners after a delete", async () => {
        const m = await withProof(true);
        await released(m, "delete");
        await expect(m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" })).rejects.toThrow(
          "That domain is not available yet"
        );
      });

      it("is held from other Owners once the domain it changed to is proven", async () => {
        const m = await withProof(true);
        await released(m, "change");
        const moved = await db.merchant.findFirstOrThrow({ where: { ownerId } });
        await m.checkDomainOwnership(ownerId, moved.id, await answering(moved.id));
        const { id } = await m.createMerchant(otherOwnerId, { ...site, name: "Other", domain: "other.example.com" });
        await expect(m.updateMerchant(otherOwnerId, id, { ...site, domain: "affiliates.example.com" })).rejects.toThrow(
          "That domain is not available yet"
        );
      });

      it("can be taken back by the Owner who gave it up", async () => {
        const m = await withProof(true);
        await released(m, "delete");
        await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
        expect(await db.releasedDomain.count()).toBe(0);
      });

      it(`is free for anyone after ${7} days`, async () => {
        const m = await withProof(true);
        expect(m.DOMAIN_HOLD_DAYS).toBe(7);
        await released(m, "delete");
        await db.releasedDomain.updateMany({ data: { releasedAt: new Date(Date.now() - 7 * DAY_MS - 1000) } });
        await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
        expect(await db.releasedDomain.count()).toBe(0);
      });

      it("is not held when it was never proven", async () => {
        const m = await withProof(true);
        const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
        await m.deleteMerchant(ownerId, id);
        expect(await db.releasedDomain.count()).toBe(0);
        await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
      });
    });

    describe("a domain another Owner claimed first", () => {
      it("is taken over while their claim is unproven, leaving their product with no domain", async () => {
        const m = await withProof(true);
        const theirs = await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
        const mine = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });

        const lost = await db.merchant.findUniqueOrThrow({ where: { id: theirs.id } });
        expect(lost).toMatchObject({ domain: null, domainToken: null, domainVerifiedAt: null });
        expect((await m.getMerchantForOwner(otherOwnerId, theirs.id))?.domain).toBe("");
        expect(await m.checkDomainOwnership(otherOwnerId, theirs.id)).toBeNull();

        // Whoever proves first keeps it.
        await m.checkDomainOwnership(ownerId, mine.id, await answering(mine.id));
        expect((await stored(mine.id)).domainVerifiedAt).not.toBeNull();
      });

      it("is taken over by a domain change too", async () => {
        const m = await withProof(true);
        const theirs = await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
        const mine = await m.createMerchant(ownerId, { ...site, domain: "mine.example.com" });
        await m.updateMerchant(ownerId, mine.id, { ...site, domain: "affiliates.example.com" });
        expect((await db.merchant.findUniqueOrThrow({ where: { id: theirs.id } })).domain).toBeNull();
      });

      it("is never taken once proven", async () => {
        const m = await withProof(true);
        const theirs = await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
        await m.checkDomainOwnership(otherOwnerId, theirs.id, await answering(theirs.id));
        await expect(m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" })).rejects.toThrow();
        expect(await db.merchant.findUniqueOrThrow({ where: { id: theirs.id } })).toMatchObject({
          domain: "affiliates.example.com",
        });
        expect((await stored(theirs.id)).domainVerifiedAt).not.toBeNull();
      });

      it("is not taken from the same Owner's other product", async () => {
        const m = await withProof(true);
        const first = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
        await expect(m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" })).rejects.toThrow();
        expect((await db.merchant.findUniqueOrThrow({ where: { id: first.id } })).domain).toBe("affiliates.example.com");
      });

      it("is a duplicate as before when proof is off", async () => {
        const m = await withProof(false);
        const theirs = await m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" });
        await db.merchant.update({ where: { id: theirs.id }, data: { domainVerifiedAt: null } });
        await expect(m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" })).rejects.toThrow();
        expect((await db.merchant.findUniqueOrThrow({ where: { id: theirs.id } })).domain).toBe("affiliates.example.com");
      });

      it("no longer counts toward its former claimant's cap", async () => {
        const m = await withProof(true);
        for (const n of [1, 2, 3]) await m.createMerchant(otherOwnerId, { ...site, domain: `a${n}.example.com` });
        await m.createMerchant(ownerId, { ...site, domain: "a1.example.com" });
        await m.createMerchant(otherOwnerId, { ...site, domain: "a4.example.com" });
      });
    });

    describe("a proven domain changed for a new one", () => {
      async function movedFromProven(m: Awaited<ReturnType<typeof withProof>>) {
        const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
        await m.checkDomainOwnership(ownerId, id, await answering(id));
        expect(await m.updateMerchant(ownerId, id, { ...site, domain: "partners.example.com" })).toEqual({ live: false });
        return id;
      }

      it("keeps serving the proven one, unheld and unclaimable, until the new one is proven", async () => {
        const m = await withProof(true);
        const id = await movedFromProven(m);
        expect(await m.getMerchantByDomain("affiliates.example.com")).toMatchObject({ id, domain: "affiliates.example.com" });
        expect(await m.getMerchantByDomain("partners.example.com")).toBeNull();
        expect(await db.releasedDomain.count()).toBe(0);
        await expect(m.createMerchant(otherOwnerId, { ...site, domain: "affiliates.example.com" })).rejects.toThrow(
          "Another product already uses that domain."
        );
      });

      it("retires the proven one when the new one is proven, and says so once", async () => {
        const m = await withProof(true);
        const id = await movedFromProven(m);
        const check = await m.checkDomainOwnership(ownerId, id, await answering(id));
        expect(check?.moved).toBe(true);
        expect(await m.getMerchantByDomain("affiliates.example.com")).toBeNull();
        expect(await m.getMerchantByDomain("partners.example.com")).toMatchObject({ id });
        expect(await db.releasedDomain.findUnique({ where: { domain: "affiliates.example.com" } })).toMatchObject({ ownerId });
        expect((await m.checkDomainOwnership(ownerId, id))?.moved).toBe(false);
      });

      it("goes back to the proven one without proof", async () => {
        const m = await withProof(true);
        const id = await movedFromProven(m);
        expect(await m.updateMerchant(ownerId, id, { ...site, domain: "affiliates.example.com" })).toEqual({ live: true });
        expect(await db.merchant.findUniqueOrThrow({ where: { id } })).toMatchObject({
          domain: "affiliates.example.com",
          previousDomain: null,
          domainToken: null,
        });
        expect((await stored(id)).domainVerifiedAt).not.toBeNull();
      });

      it("falls back to the proven one when another Owner takes the new one", async () => {
        const m = await withProof(true);
        const id = await movedFromProven(m);
        await m.createMerchant(otherOwnerId, { ...site, domain: "partners.example.com" });
        expect(await db.merchant.findUniqueOrThrow({ where: { id } })).toMatchObject({
          domain: "affiliates.example.com",
          previousDomain: null,
        });
        expect((await stored(id)).domainVerifiedAt).not.toBeNull();
      });

      it("holds the proven one when the product is deleted before the new one is proven", async () => {
        const m = await withProof(true);
        const id = await movedFromProven(m);
        await m.deleteMerchant(ownerId, id);
        expect(await db.releasedDomain.findUnique({ where: { domain: "affiliates.example.com" } })).toMatchObject({ ownerId });
      });
    });

    it("reports proof only from when it was found, and makes a token when one is missing", async () => {
      const m = await withProof(true);
      const { id } = await m.createMerchant(ownerId, { ...site, domain: "affiliates.example.com" });
      await db.merchant.update({ where: { id }, data: { domainToken: null } });
      const check = await m.checkDomainOwnership(ownerId, id, async () => []);
      expect(check?.result.ok).toBe(false);
      const { domainToken } = await stored(id);
      expect(domainToken).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(check?.record?.value).toBe(`supaffi-verification=${domainToken}`);
    });

    describe("domains waiting for proof", () => {
      it("are capped per Owner", async () => {
        const m = await withProof(true);
        expect(m.MAX_UNVERIFIED_DOMAINS).toBe(3);
        for (const n of [1, 2, 3]) await m.createMerchant(ownerId, { ...site, domain: `a${n}.example.com` });
        await expect(m.createMerchant(ownerId, { ...site, domain: "a4.example.com" })).rejects.toThrow(
          "Verify one first"
        );
        // Another Owner has their own allowance.
        await m.createMerchant(otherOwnerId, { ...site, domain: "b1.example.com" });
      });

      it("hold the cap against saves at the same moment", async () => {
        const m = await withProof(true);
        const results = await Promise.allSettled(
          [1, 2, 3, 4, 5].map((n) => m.createMerchant(ownerId, { ...site, name: `P${n}`, domain: `a${n}.example.com` }))
        );
        expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
        expect(await db.merchant.count({ where: { ownerId } })).toBe(3);
      });

      it("still let a waiting product change its own domain", async () => {
        const m = await withProof(true);
        const ids: string[] = [];
        for (const n of [1, 2, 3]) ids.push((await m.createMerchant(ownerId, { ...site, domain: `a${n}.example.com` })).id);
        await m.updateMerchant(ownerId, ids[0], { ...site, domain: "a9.example.com" });
      });

      it("free a place once one is proven", async () => {
        const m = await withProof(true);
        const ids: string[] = [];
        for (const n of [1, 2, 3]) ids.push((await m.createMerchant(ownerId, { ...site, domain: `a${n}.example.com` })).id);
        await m.checkDomainOwnership(ownerId, ids[0], await answering(ids[0]));
        await m.createMerchant(ownerId, { ...site, domain: "a4.example.com" });
      });
    });
  });
});

describe("proveDomain", () => {
  const base = { domain: "affiliates.example.com", record: null, result: { ok: true, detail: "Verified" } };

  async function proveWith(move: () => Promise<string>) {
    vi.resetModules();
    vi.doMock("@/lib/db", () => ({ db: { merchant: { findFirst: async () => ({ paymentProvider: "STRIPE" }) } } }));
    vi.doMock("@/lib/payments", () => ({ paymentProviderFor: () => ({ moveWebhookEndpoint: move }) }));
    return (await import("@/lib/domainProof")).proveDomain;
  }

  afterAll(() => {
    vi.doUnmock("@/lib/db");
    vi.doUnmock("@/lib/payments");
  });

  it("moves the payment webhook on the check that proves a domain the product moved to", async () => {
    const move = vi.fn(async () => "manual");
    const proveDomain = await proveWith(move);
    const result = await proveDomain("owner-1", "product-1", async () => ({ ...base, moved: true }));
    expect(move).toHaveBeenCalledWith("product-1");
    expect(result?.webhook).toBe("manual");
  });

  it("leaves the webhook alone otherwise", async () => {
    const move = vi.fn(async () => "moved");
    const proveDomain = await proveWith(move);
    expect((await proveDomain("owner-1", "product-1", async () => ({ ...base, moved: false })))?.webhook).toBe("none");
    expect(await proveDomain("owner-1", "product-1", async () => null)).toBeNull();
    expect(move).not.toHaveBeenCalled();
  });
});
