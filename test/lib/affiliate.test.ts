// Destructive: runs db.affiliate.deleteMany() / db.program.deleteMany() /
// db.merchant.deleteMany() / db.owner.deleteMany() before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import {
  createAffiliate,
  listAffiliatesForMerchant,
  getAffiliateSignals,
  type AffiliateListFilters,
  getAffiliateByEmail,
  getAffiliateSession,
  getAffiliateStats,
  listAffiliateCommissions,
  updateAffiliatePayoutDetails,
  getAffiliatePayoutDetails,
  toDisplayStatus,
} from "@/lib/affiliate";
import { isUniqueConstraintErrorOn } from "@/lib/prismaErrors";

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
    "Skipping test/lib/affiliate.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

describe.skipIf(!hasDatabase)("affiliate", () => {
  let ownerId: string;
  let merchantId: string;
  let programId: string;
  let vipProgramId: string;
  let otherMerchantId: string;
  let otherProgramId: string;
  let foreignOwnerId: string;

  beforeEach(async () => {
    await db.commission.deleteMany();
    await db.click.deleteMany();
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    const owner = await db.owner.create({
      data: { email: "affiliate-lib-owner@example.com", passwordHash: "x" },
    });
    ownerId = owner.id;
    const foreignOwner = await db.owner.create({
      data: { email: "affiliate-lib-foreign@example.com", passwordHash: "x" },
    });
    foreignOwnerId = foreignOwner.id;
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "TestCo",
        domain: "affiliate-lib-test.example.com",
        websiteUrl: "https://affiliate-lib-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId = merchant.id;
    const program = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    programId = program.id;
    const vipProgram = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId,
        name: "VIP",
        defaultCommissionRate: "40.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    vipProgramId = vipProgram.id;

    const otherMerchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "OtherCo",
        domain: "affiliate-lib-other.example.com",
        websiteUrl: "https://affiliate-lib-other.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    otherMerchantId = otherMerchant.id;
    const otherProgram = await db.program.create({
      data: {
        slug: crypto.randomUUID(),
        merchantId: otherMerchantId,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    otherProgramId = otherProgram.id;
  });

  afterAll(async () => {
    await db.commission.deleteMany();
    await db.click.deleteMany();
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates an Affiliate with a normalized email and a generated referral code", async () => {
    const affiliate = await createAffiliate(merchantId, programId, {
      name: "Sarah Chen",
      email: "  Sarah@Example.com  ",
    });

    expect(affiliate.email).toBe("sarah@example.com");
    expect(affiliate.referralCode).toBe("sarahchen");
  });

  it("getAffiliateByEmail is case/whitespace-insensitive on lookup", async () => {
    await createAffiliate(merchantId, programId, { name: "Sarah", email: "sarah@example.com" });

    const result = await getAffiliateByEmail(merchantId, "  SARAH@example.com ");
    expect(result?.email).toBe("sarah@example.com");
  });

  it("getAffiliateByEmail does not find an Affiliate that belongs to a different Merchant", async () => {
    await createAffiliate(otherMerchantId, otherProgramId, {
      name: "Sarah",
      email: "sarah@example.com",
    });

    const result = await getAffiliateByEmail(merchantId, "sarah@example.com");
    expect(result).toBeNull();
  });

  it("getAffiliateSession returns the referral code and the owning Merchant's real site", async () => {
    const affiliate = await createAffiliate(merchantId, programId, {
      name: "Sarah",
      email: "sarah@example.com",
    });

    const result = await getAffiliateSession(affiliate.id);
    expect(result).toEqual({
      referralCode: "sarah",
      merchantWebsiteUrl: "https://affiliate-lib-test.example.com",
      merchantId,
    });
  });

  it("getAffiliateSession returns null for an unknown id", async () => {
    const result = await getAffiliateSession("does-not-exist");
    expect(result).toBeNull();
  });

  // Affiliate has two separate unique constraints: a per-Merchant
  // (merchantId, email) pair, and a globally-unique referralCode. A bare
  // isUniqueConstraintError(err) can't tell these apart, which matters
  // because createAffiliateSignup reacts very differently to each (treat
  // as an existing-login vs. retry with a freshly generated code). These
  // two tests prove isUniqueConstraintErrorOn correctly distinguishes a
  // real P2002 triggered by each constraint.
  it("isUniqueConstraintErrorOn identifies an (merchantId, email) collision as an email violation, not a referralCode one", async () => {
    await createAffiliate(merchantId, programId, { name: "Sarah", email: "sarah@example.com" });

    let caught: unknown;
    try {
      await db.affiliate.create({
        data: {
          merchantId,
          programId,
          email: "sarah@example.com",
          name: "Sarah Duplicate",
          referralCode: "some-other-unused-code",
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueConstraintErrorOn(caught, "email")).toBe(true);
    expect(isUniqueConstraintErrorOn(caught, "referralCode")).toBe(false);
  });

  it("isUniqueConstraintErrorOn identifies a referralCode collision as a referralCode violation, not an email one — even across different Merchants, since referralCode is globally unique", async () => {
    await createAffiliate(merchantId, programId, { name: "Sarah", email: "sarah@example.com" });

    let caught: unknown;
    try {
      // Different Merchant, different email — only the referralCode collides.
      await db.affiliate.create({
        data: {
          merchantId: otherMerchantId,
          programId: otherProgramId,
          email: "sarah-from-other-merchant@example.com",
          name: "Sarah",
          referralCode: "sarah",
        },
      });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(isUniqueConstraintErrorOn(caught, "referralCode")).toBe(true);
    expect(isUniqueConstraintErrorOn(caught, "email")).toBe(false);
  });

  describe("getAffiliateStats / listAffiliateCommissions / updateAffiliatePayoutDetails", () => {
    async function makeAffiliateWithClickAndCommission(opts: {
      email: string;
      referralCode: string;
      status: "PENDING" | "FLAGGED" | "PAYABLE" | "PAID" | "VOIDED";
      currency: string;
      amount: string;
    }) {
      const affiliate = await db.affiliate.create({
        data: { merchantId, programId, email: opts.email, referralCode: opts.referralCode },
      });
      const click = await db.click.create({
        data: {
          affiliateId: affiliate.id,
          referralToken: `${opts.referralCode}-token`,
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await db.commission.create({
        data: {
          affiliateId: affiliate.id,
          clickId: click.id,
          amount: opts.amount,
          currency: opts.currency,
          status: opts.status,
          payableAt: new Date(),
          flagReason: opts.status === "FLAGGED" ? "buyer email matches affiliate email" : null,
        },
      });
      return affiliate;
    }

    it("counts total clicks and merges FLAGGED into the PENDING total, never exposing FLAGGED itself", async () => {
      const affiliate = await makeAffiliateWithClickAndCommission({
        email: "stats-a@example.com",
        referralCode: "stats-a",
        status: "PENDING",
        currency: "usd",
        amount: "10.00",
      });
      // Second click+commission on the same affiliate, FLAGGED, same currency —
      // must merge into the same PENDING total, not appear as its own bucket.
      const secondClick = await db.click.create({
        data: {
          affiliateId: affiliate.id,
          referralToken: "stats-a-token-2",
          expiresAt: new Date(Date.now() + 60_000),
        },
      });
      await db.commission.create({
        data: {
          affiliateId: affiliate.id,
          clickId: secondClick.id,
          amount: "5.00",
          currency: "usd",
          status: "FLAGGED",
          payableAt: new Date(),
          flagReason: "buyer email matches affiliate email",
        },
      });

      const stats = await getAffiliateStats(affiliate.id);

      expect(stats.totalClicks).toBe(2);
      expect(stats.totals).toHaveLength(1);
      expect(stats.totals[0]).toEqual({ currency: "usd", status: "PENDING", amount: "15.00" });
      expect(stats.totals.some((t) => (t.status as string) === "FLAGGED")).toBe(false);
    });

    it("keeps different currencies and statuses in separate totals, never summed together", async () => {
      const affiliate = await db.affiliate.create({
        data: { merchantId, programId, email: "stats-b@example.com", referralCode: "stats-b" },
      });
      const click = await db.click.create({
        data: { affiliateId: affiliate.id, referralToken: "stats-b-token", expiresAt: new Date(Date.now() + 60_000) },
      });
      await db.commission.createMany({
        data: [
          { affiliateId: affiliate.id, clickId: click.id, amount: "20.00", currency: "usd", status: "PAYABLE", payableAt: new Date() },
          { affiliateId: affiliate.id, clickId: click.id, amount: "30.00", currency: "eur", status: "PAYABLE", payableAt: new Date() },
          { affiliateId: affiliate.id, clickId: click.id, amount: "40.00", currency: "usd", status: "PAID", payableAt: new Date(), paidAt: new Date() },
        ],
      });

      const stats = await getAffiliateStats(affiliate.id);

      expect(stats.totals).toHaveLength(3);
      expect(stats.totals).toEqual(
        expect.arrayContaining([
          { currency: "usd", status: "PAYABLE", amount: "20.00" },
          { currency: "eur", status: "PAYABLE", amount: "30.00" },
          { currency: "usd", status: "PAID", amount: "40.00" },
        ])
      );
    });

    it("paginates commission history newest first and remaps FLAGGED to PENDING per row", async () => {
      const affiliate = await db.affiliate.create({
        data: { merchantId, programId, email: "history@example.com", referralCode: "history" },
      });
      const click = await db.click.create({
        data: { affiliateId: affiliate.id, referralToken: "history-token", expiresAt: new Date(Date.now() + 60_000) },
      });
      for (let i = 0; i < 3; i++) {
        await db.commission.create({
          data: {
            affiliateId: affiliate.id,
            clickId: click.id,
            amount: `${i + 1}.00`,
            currency: "usd",
            status: i === 0 ? "FLAGGED" : "PENDING",
            payableAt: new Date(),
            flagReason: i === 0 ? "buyer email matches affiliate email" : null,
            createdAt: new Date(Date.now() + i * 1000),
          },
        });
      }

      const page1 = await listAffiliateCommissions(affiliate.id, { page: 1, pageSize: 2 });
      expect(page1.total).toBe(3);
      expect(page1.rows).toHaveLength(2);
      expect(page1.rows[0].amount).toBe("3.00"); // newest first
      expect(page1.rows[1].amount).toBe("2.00");

      const page2 = await listAffiliateCommissions(affiliate.id, { page: 2, pageSize: 2 });
      expect(page2.rows).toHaveLength(1);
      expect(page2.rows[0].amount).toBe("1.00");
      expect(page2.rows[0].status).toBe("PENDING"); // was FLAGGED, must read as PENDING
      expect((page2.rows[0] as unknown as { flagReason?: unknown }).flagReason).toBeUndefined();
    });

    it("updates payout details, and blanks out to null rather than storing an empty string", async () => {
      const affiliate = await db.affiliate.create({
        data: { merchantId, programId, email: "payout@example.com", referralCode: "payout" },
      });

      await updateAffiliatePayoutDetails(affiliate.id, "PayPal: payout@example.com");
      let updated = await db.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } });
      expect(updated.payoutDetails).toBe("PayPal: payout@example.com");

      await updateAffiliatePayoutDetails(affiliate.id, "");
      updated = await db.affiliate.findUniqueOrThrow({ where: { id: affiliate.id } });
      expect(updated.payoutDetails).toBeNull();

      expect(await getAffiliatePayoutDetails(affiliate.id)).toBeNull();
    });

    it("toDisplayStatus defaults an unrecognized status to PENDING (fail closed)", () => {
      expect(toDisplayStatus("SOME_FUTURE_STATUS")).toBe("PENDING");
      expect(toDisplayStatus("PENDING")).toBe("PENDING");
      expect(toDisplayStatus("PAYABLE")).toBe("PAYABLE");
      expect(toDisplayStatus("PAID")).toBe("PAID");
      expect(toDisplayStatus("VOIDED")).toBe("VOIDED");
      expect(toDisplayStatus("FLAGGED")).toBe("PENDING");
    });
  });

  async function makeAffiliate(fields: {
    email: string;
    name?: string | null;
    referralCode: string;
    programId?: string;
    customCommissionRate?: string;
    merchantId?: string;
  }) {
    return db.affiliate.create({
      data: {
        merchantId: fields.merchantId ?? merchantId,
        programId: fields.programId ?? programId,
        email: fields.email,
        name: fields.name ?? null,
        referralCode: fields.referralCode,
        customCommissionRate: fields.customCommissionRate ?? null,
      },
    });
  }

  async function makeClick(affiliateId: string) {
    return db.click.create({
      data: {
        affiliateId,
        referralToken: crypto.randomUUID(),
        expiresAt: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      },
    });
  }

  async function makeCommission(
    affiliateId: string,
    amount: string,
    currency: string,
    status: "PENDING" | "PAYABLE" | "PAID" | "VOIDED" | "FLAGGED" = "PAYABLE"
  ) {
    const click = await makeClick(affiliateId);
    return db.commission.create({
      data: {
        affiliateId,
        clickId: click.id,
        amount,
        currency,
        status,
        payableAt: new Date(),
        stripePaymentRef: crypto.randomUUID(),
      },
    });
  }

  describe("listAffiliatesForMerchant", () => {
    const NO_FILTERS: AffiliateListFilters = { programId: null, query: null };
    const PAGE = { page: 1, pageSize: 25 };

    it("falls back to the Program's default rate and prefers the override when set", async () => {
      const standard = await makeAffiliate({ email: "sarah@example.com", referralCode: "sarah" });
      const overridden = await makeAffiliate({
        email: "rob@example.com",
        referralCode: "rob",
        customCommissionRate: "42.50",
      });

      const { rows } = await listAffiliatesForMerchant(ownerId, merchantId, NO_FILTERS, PAGE);
      const byId = new Map(rows.map((r) => [r.id, r]));

      expect(byId.get(standard.id)?.commissionRate).toBe("20");
      expect(byId.get(standard.id)?.rateIsOverride).toBe(false);
      expect(byId.get(overridden.id)?.commissionRate).toBe("42.5");
      expect(byId.get(overridden.id)?.rateIsOverride).toBe(true);
    });

    it("honours a zero override, which is not the same as no override", async () => {
      const unpaid = await makeAffiliate({
        email: "unpaid@example.com",
        referralCode: "unpaid",
        customCommissionRate: "0.00",
      });

      const { rows } = await listAffiliatesForMerchant(ownerId, merchantId, NO_FILTERS, PAGE);
      const row = rows.find((r) => r.id === unpaid.id);

      expect(row?.commissionRate).toBe("0");
      expect(row?.rateIsOverride).toBe(true);
    });

    it("counts clicks and conversions per affiliate", async () => {
      const busy = await makeAffiliate({ email: "busy@example.com", referralCode: "busy" });
      const quiet = await makeAffiliate({ email: "quiet@example.com", referralCode: "quiet" });

      await makeClick(busy.id);
      await makeCommission(busy.id, "10.00", "usd");
      await makeCommission(busy.id, "5.00", "usd");
      await makeClick(quiet.id);

      const { rows, total } = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        NO_FILTERS,
        PAGE
      );
      const byId = new Map(rows.map((r) => [r.id, r]));

      expect(total).toBe(2);
      // Three clicks: one on its own, plus the one behind each commission.
      expect(byId.get(busy.id)?.clicks).toBe(3);
      expect(byId.get(busy.id)?.conversions).toBe(2);
      expect(byId.get(quiet.id)?.clicks).toBe(1);
      expect(byId.get(quiet.id)?.conversions).toBe(0);
    });

    it("keeps earnings per currency and leaves voided money out", async () => {
      const affiliate = await makeAffiliate({ email: "multi@example.com", referralCode: "multi" });
      await makeCommission(affiliate.id, "10.00", "usd", "PAYABLE");
      await makeCommission(affiliate.id, "5.00", "usd", "PAID");
      await makeCommission(affiliate.id, "7.00", "eur", "PENDING");
      await makeCommission(affiliate.id, "99.00", "usd", "VOIDED");

      const { rows } = await listAffiliatesForMerchant(ownerId, merchantId, NO_FILTERS, PAGE);

      expect(rows[0].earned).toEqual([
        { currency: "eur", total: "7.00" },
        { currency: "usd", total: "15.00" },
      ]);
    });

    it("filters by program", async () => {
      await makeAffiliate({ email: "std@example.com", referralCode: "std" });
      const vip = await makeAffiliate({
        email: "vip@example.com",
        referralCode: "vip",
        programId: vipProgramId,
      });

      const { rows, total } = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        { programId: vipProgramId, query: null },
        PAGE
      );

      expect(total).toBe(1);
      expect(rows.map((r) => r.id)).toEqual([vip.id]);
      expect(rows[0].programName).toBe("VIP");
      expect(rows[0].commissionRate).toBe("40");
    });

    it("searches over name, email and referral code", async () => {
      const byName = await makeAffiliate({
        email: "a@example.com",
        name: "Marguerite",
        referralCode: "zzz-a",
      });
      const byEmail = await makeAffiliate({
        email: "someone@needle.test",
        name: "Bob",
        referralCode: "zzz-b",
      });
      const byCode = await makeAffiliate({
        email: "c@example.com",
        name: "Carol",
        referralCode: "haystack-code",
      });

      const nameHit = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        { programId: null, query: "marguer" },
        PAGE
      );
      expect(nameHit.rows.map((r) => r.id)).toEqual([byName.id]);

      const emailHit = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        { programId: null, query: "NEEDLE.test" },
        PAGE
      );
      expect(emailHit.rows.map((r) => r.id)).toEqual([byEmail.id]);

      const codeHit = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        { programId: null, query: "haystack" },
        PAGE
      );
      expect(codeHit.rows.map((r) => r.id)).toEqual([byCode.id]);
    });

    it("never returns another Merchant's affiliates", async () => {
      await makeAffiliate({ email: "mine@example.com", referralCode: "mine" });
      await makeAffiliate({
        email: "theirs@example.com",
        referralCode: "theirs",
        merchantId: otherMerchantId,
        programId: otherProgramId,
      });

      const { rows, total } = await listAffiliatesForMerchant(
        ownerId,
        merchantId,
        NO_FILTERS,
        PAGE
      );

      expect(total).toBe(1);
      expect(rows[0].email).toBe("mine@example.com");
    });

    it("throws for a Merchant that belongs to another Owner", async () => {
      await expect(
        listAffiliatesForMerchant(foreignOwnerId, merchantId, NO_FILTERS, PAGE)
      ).rejects.toThrow("Merchant not found");
    });
  });

  describe("getAffiliateSignals", () => {
    it("counts an affiliate as earning only once a commission is not voided", async () => {
      const voidedOnly = await makeAffiliate({
        email: "voided@example.com",
        referralCode: "voided",
      });
      const earner = await makeAffiliate({ email: "earner@example.com", referralCode: "earner" });
      const idle = await makeAffiliate({ email: "idle@example.com", referralCode: "idle" });

      await makeCommission(voidedOnly.id, "50.00", "usd", "VOIDED");
      await makeCommission(voidedOnly.id, "20.00", "usd", "VOIDED");
      await makeCommission(earner.id, "10.00", "usd", "PENDING");

      const signals = await getAffiliateSignals(ownerId, merchantId);

      expect(signals.total).toBe(3);
      expect(signals.earning).toBe(1);
      expect(idle.id).toBeTruthy();
    });

    it("counts a flagged commission as earning, since it has not been voided", async () => {
      const flagged = await makeAffiliate({ email: "flag@example.com", referralCode: "flag" });
      await makeCommission(flagged.id, "10.00", "usd", "FLAGGED");

      const signals = await getAffiliateSignals(ownerId, merchantId);
      expect(signals.earning).toBe(1);
    });

    it("counts only this Merchant's affiliates, and refuses another Owner's", async () => {
      await makeAffiliate({ email: "mine@example.com", referralCode: "mine" });
      await makeAffiliate({
        email: "theirs@example.com",
        referralCode: "theirs",
        merchantId: otherMerchantId,
        programId: otherProgramId,
      });

      const signals = await getAffiliateSignals(ownerId, merchantId);
      expect(signals.total).toBe(1);
      expect(signals.joinedThisMonth).toBe(1);

      await expect(getAffiliateSignals(foreignOwnerId, merchantId)).rejects.toThrow(
        "Merchant not found"
      );
    });
  });

});
