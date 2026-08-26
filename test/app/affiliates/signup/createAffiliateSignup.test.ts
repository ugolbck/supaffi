// Destructive: runs db.affiliateLoginToken.deleteMany() / db.affiliate.deleteMany() /
// db.program.deleteMany() / db.merchant.deleteMany() / db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
//
// This is the only test that calls createAffiliateSignup (the Server
// Action) directly rather than testing a lower-level lib function, because
// the retry-on-referralCode-collision behavior in its catch block
// (src/app/affiliates/signup/[programId]/createAffiliateSignup.ts) can only
// be proven correct by exercising that catch block itself against a real
// P2002 from Postgres.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

// createAffiliateSignup reads the request Host via next/headers' headers().
// There's no existing precedent in this codebase for testing a Server
// Action that calls headers() directly, so it's mocked here to a fixed
// host matching the test Merchant's domain — the minimum needed to drive
// the action through its real Host -> Merchant -> Program -> Affiliate path.
const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

// The email send is already covered by test/lib/email/affiliateMagicLink.test.ts;
// stubbing it here keeps this test focused on the create/retry logic and
// avoids needing a real MASTER_ENCRYPTION_KEY-encrypted credential blob.
const sendAffiliateMagicLinkEmailMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/email/affiliateMagicLink", () => ({
  sendAffiliateMagicLinkEmail: (...args: unknown[]) => sendAffiliateMagicLinkEmailMock(...args),
}));

// generateReferralCode does its own read-before-write collision check, which
// makes the real race it's vulnerable to hard to force deterministically in
// a single-process test: two sequential signups would just see each other's
// row and each pick their own next free suffix, never reaching
// createAffiliateSignup's retry branch. Stub it to hand out a scripted
// sequence of candidates instead, so the second signup's first attempt can
// be forced to collide with the first signup's already-committed row. The
// P2002 that results is real (thrown by Postgres via Prisma, not mocked) —
// only the code-picking is scripted, to make the collision reliable instead
// of racy.
const referralCodeQueue: string[] = [];
vi.mock("@/lib/referralCode", () => ({
  generateReferralCode: vi.fn(async () => {
    const next = referralCodeQueue.shift();
    if (next === undefined) throw new Error("test referralCodeQueue exhausted");
    return next;
  }),
}));

import { createAffiliateSignup } from "@/app/affiliates/signup/[programId]/createAffiliateSignup";

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
    "Skipping test/app/affiliates/signup/createAffiliateSignup.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

function formDataFor(name: string, email: string): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("email", email);
  return fd;
}

describe.skipIf(!hasDatabase)("createAffiliateSignup", () => {
  let merchantId: string;
  let programId: string;

  beforeEach(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    sendAffiliateMagicLinkEmailMock.mockClear();
    referralCodeQueue.length = 0;

    const owner = await db.owner.create({
      data: { email: "signup-action-owner@example.com", passwordHash: "x" },
    });
    const merchant = await db.merchant.create({
      data: {
        ownerId: owner.id,
        name: "TestCo",
        domain: "signup-action-test.example.com",
        websiteUrl: "https://signup-action-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
        emailProviderConfigEnc: "x",
      },
    });
    merchantId = merchant.id;
    const program = await db.program.create({
      data: {
        merchantId,
        name: "Standard",
        defaultCommissionRate: "20.00",
        commissionDurationType: "FOREVER",
        attributionWindowDays: 60,
        holdingPeriodDays: 30,
      },
    });
    programId = program.id;

    headersMock.mockResolvedValue(new Headers({ host: "signup-action-test.example.com" }));
  });

  afterAll(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("retries with a fresh referral code and creates a distinct Affiliate row on a referralCode collision, instead of throwing", async () => {
    // First "Sarah" claims the "sarah" code.
    referralCodeQueue.push("sarah");
    const first = await createAffiliateSignup(
      programId,
      { status: "form", error: "" },
      formDataFor("Sarah", "sarah1@example.com")
    );
    expect(first.status).toBe("sent");

    // A second, different "Sarah" signs up. Her first attempt is scripted to
    // reuse "sarah" too (simulating the race generateReferralCode is
    // vulnerable to), which collides for real against Sarah 1's committed
    // row and throws a genuine P2002 on referralCode. createAffiliateSignup
    // must recognize that (not conflate it with an email collision), retry
    // once, and succeed with the next scripted code.
    referralCodeQueue.push("sarah", "sarah2");
    const second = await createAffiliateSignup(
      programId,
      { status: "form", error: "" },
      formDataFor("Sarah", "sarah2@example.com")
    );
    expect(second.status).toBe("sent");
    expect(second.error).toBe("");

    const affiliates = await db.affiliate.findMany({
      where: { merchantId },
      select: { email: true, referralCode: true },
      orderBy: { email: "asc" },
    });
    expect(affiliates).toEqual([
      { email: "sarah1@example.com", referralCode: "sarah" },
      { email: "sarah2@example.com", referralCode: "sarah2" },
    ]);
    expect(sendAffiliateMagicLinkEmailMock).toHaveBeenCalledTimes(2);
  });

  it("still treats a genuine duplicate signup (same email) as an existing-login request, not a referralCode retry", async () => {
    referralCodeQueue.push("sarah");
    await createAffiliateSignup(
      programId,
      { status: "form", error: "" },
      formDataFor("Sarah", "sarah@example.com")
    );

    // Same email again, with a different name/slug so this exercises the
    // email-collision branch specifically, not the referralCode one.
    referralCodeQueue.push("sarah-again");
    const repeat = await createAffiliateSignup(
      programId,
      { status: "form", error: "" },
      formDataFor("Sarah Again", "sarah@example.com")
    );

    expect(repeat.status).toBe("sent");
    const affiliates = await db.affiliate.findMany({ where: { merchantId } });
    expect(affiliates).toHaveLength(1); // no new row — treated as a login for the existing one
    expect(sendAffiliateMagicLinkEmailMock).toHaveBeenCalledTimes(2);
  });
});
