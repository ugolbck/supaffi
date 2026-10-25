// Destructive: runs db.affiliateLoginToken.deleteMany() / db.affiliateLink.deleteMany() /
// db.affiliate.deleteMany() / db.program.deleteMany() / db.merchant.deleteMany() /
// db.owner.deleteMany()
// before every test. Point DATABASE_URL at a disposable database, never a
// real deployment's data.
//
// This is the only test that calls createAffiliateSignup (the Server
// Action) directly rather than testing a lower-level lib function, because
// the retry-on-referralCode-collision behavior in its catch block
// (src/app/affiliates/signup/[program]/createAffiliateSignup.ts) can only
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

// A successful signup logs the Affiliate straight in through Auth.js, which
// needs a real request context to set its cookie. Stubbed here so the test
// stays on the create/retry logic and can still see whether a login was
// attempted, and with what.
const signInMock = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/auth", () => ({
  signIn: (...args: unknown[]) => signInMock(...args),
}));

// generateLinkCode does its own read-before-write collision check, which
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
  generateLinkCode: vi.fn(async () => {
    const next = referralCodeQueue.shift();
    if (next === undefined) throw new Error("test referralCodeQueue exhausted");
    return next;
  }),
}));

import { createAffiliateSignup } from "@/app/affiliates/signup/[program]/createAffiliateSignup";
import { resetAffiliateSignupThrottle } from "@/lib/affiliateSignupThrottle";
import { verifyPassword } from "@/lib/password";
import { affiliateSessionIsCurrent } from "@/lib/affiliateSession";

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

const PASSWORD = "correct horse battery";

function formDataFor(name: string, email: string, password: string = PASSWORD): FormData {
  const fd = new FormData();
  fd.set("name", name);
  fd.set("email", email);
  fd.set("password", password);
  return fd;
}

// A chosen code is only "chosen" when codeTouched is set, matching the
// SignupForm client: the live preview always carries some value, and only a
// touched one is a deliberate pick the server must never silently swap out.
function formDataWithChosenCode(name: string, email: string, code: string): FormData {
  const fd = formDataFor(name, email);
  fd.set("code", code);
  fd.set("codeTouched", "1");
  return fd;
}

describe.skipIf(!hasDatabase)("createAffiliateSignup", () => {
  let merchantId: string;
  let programSlug: string;

  beforeEach(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliateLink.deleteMany();
    await db.affiliate.deleteMany();
    await db.program.deleteMany();
    await db.merchant.deleteMany();
    await db.owner.deleteMany();

    signInMock.mockClear();
    resetAffiliateSignupThrottle();
    referralCodeQueue.length = 0;

    const owner = await db.owner.create({
      data: { email: "signup-action-owner@example.com", passwordHash: "x" },
    });
    const merchant = await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "TestCo",
        domain: "signup-action-test.example.com",
        websiteUrl: "https://signup-action-test.example.com",
        stripeSecretKeyEnc: "x",
        stripeWebhookSecretEnc: "x",
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
    programSlug = program.slug;

    headersMock.mockResolvedValue(new Headers({ host: "signup-action-test.example.com" }));
  });

  afterAll(async () => {
    await db.affiliateLoginToken.deleteMany();
    await db.affiliateLink.deleteMany();
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
      programSlug,
      { error: "" },
      formDataFor("Sarah", "sarah1@example.com")
    );
    expect(first.error).toBe("");

    // A second, different "Sarah" signs up. Her first attempt is scripted to
    // reuse "sarah" too (simulating the race generateReferralCode is
    // vulnerable to), which collides for real against Sarah 1's committed
    // row and throws a genuine P2002 on referralCode. createAffiliateSignup
    // must recognize that (not conflate it with an email collision), retry
    // once, and succeed with the next scripted code.
    referralCodeQueue.push("sarah", "sarah2");
    const second = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataFor("Sarah", "sarah2@example.com")
    );
    expect(second.error).toBe("");

    const affiliates = await db.affiliate.findMany({
      where: { merchantId },
      select: { email: true, links: { where: { isPrimary: true }, select: { code: true } } },
      orderBy: { email: "asc" },
    });
    expect(affiliates.map((a) => ({ email: a.email, referralCode: a.links[0]?.code ?? "" }))).toEqual([
      { email: "sarah1@example.com", referralCode: "sarah" },
      { email: "sarah2@example.com", referralCode: "sarah2" },
    ]);
    expect(signInMock).toHaveBeenCalledTimes(2);
  });

  it("does not stamp a password change at signup, so the session it starts is kept", async () => {
    referralCodeQueue.push("sarah");
    await createAffiliateSignup(programSlug, { error: "" }, formDataFor("Sarah", "sarah@example.com"));

    const affiliate = await db.affiliate.findFirstOrThrow({ where: { merchantId, email: "sarah@example.com" } });
    expect(affiliate.passwordChangedAt).toBeNull();
    expect(await affiliateSessionIsCurrent(affiliate.id, Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("refuses a second signup with an email already registered, without logging anyone in", async () => {
    referralCodeQueue.push("sarah");
    await createAffiliateSignup(programSlug, { error: "" }, formDataFor("Sarah", "sarah@example.com"));
    signInMock.mockClear();

    // Same email again, with a different name/slug so this exercises the
    // email-collision branch specifically, not the referralCode one. Whoever
    // submits it has not proved they own the account, so it is never a login.
    referralCodeQueue.push("sarah-again");
    const repeat = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataFor("Sarah Again", "sarah@example.com", "someone elses password")
    );

    expect(repeat.error).toBe("You already have an account here. Log in instead.");
    expect(await db.affiliate.count({ where: { merchantId } })).toBe(1);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("creates the Affiliate with a hash of their password and logs them in", async () => {
    referralCodeQueue.push("sarah");
    const result = await createAffiliateSignup(programSlug, { error: "" }, formDataFor("Sarah", "sarah@example.com"));

    expect(result.error).toBe("");
    const affiliate = await db.affiliate.findFirstOrThrow({ where: { merchantId }, select: { passwordHash: true } });
    expect(affiliate.passwordHash).toBeTruthy();
    expect(affiliate.passwordHash).not.toBe(PASSWORD);
    expect(await verifyPassword(PASSWORD, affiliate.passwordHash!)).toBe(true);
    expect(signInMock).toHaveBeenCalledTimes(1);
    expect(signInMock).toHaveBeenCalledWith("affiliate-password", {
      email: "sarah@example.com",
      password: PASSWORD,
      redirectTo: "/affiliates/dashboard",
    });
  });

  it("refuses a password that is too short before touching the database", async () => {
    const result = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataFor("Sarah", "sarah@example.com", "short")
    );

    expect(result.error).toMatch(/^Use at least \d+ characters$/);
    expect(await db.affiliate.count({ where: { merchantId } })).toBe(0);
    expect(signInMock).not.toHaveBeenCalled();
  });

  it("keeps creating Affiliates behind a proxy that does not forward the visitor address", async () => {
    // Every request looks like the proxy here. Counting that as one visitor
    // would stop the whole instance at twenty signups an hour.
    headersMock.mockResolvedValue(
      new Headers({ host: "signup-action-test.example.com", "x-forwarded-for": "172.18.0.3" })
    );
    for (let i = 0; i < 25; i += 1) {
      const result = await createAffiliateSignup(
        programSlug,
        { error: "" },
        formDataWithChosenCode(`Person ${i}`, `person-${i}@example.com`, `person-${i}`)
      );
      expect(result.error).toBe("");
    }
    expect(await db.affiliate.count({ where: { merchantId } })).toBe(25);
    expect(signInMock).toHaveBeenCalledTimes(25);
  });

  it("creates the Affiliate with the exact code they chose, not a name-derived one", async () => {
    const result = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataWithChosenCode("Sarah", "sarah@example.com", "my-own-code")
    );

    expect(result.error).toBe("");
    const affiliate = await db.affiliate.findFirst({
      where: { merchantId },
      select: { links: { where: { isPrimary: true }, select: { code: true } } },
    });
    expect(affiliate?.links[0]?.code).toBe("my-own-code");
    // generateLinkCode is never consulted for a chosen code.
    expect(referralCodeQueue).toHaveLength(0);
  });

  it("reports a chosen code that is already taken, instead of silently swapping it for another", async () => {
    referralCodeQueue.push("taken-code");
    await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataFor("First", "first@example.com")
    );

    const result = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataWithChosenCode("Second", "second@example.com", "taken-code")
    );

    expect(result.error).toBe("That code is already taken. Try another.");

    // No Affiliate was created for the rejected attempt, and nobody was
    // logged in for it: only the first, successful signup was.
    const affiliates = await db.affiliate.findMany({ where: { merchantId } });
    expect(affiliates).toHaveLength(1);
    expect(signInMock).toHaveBeenCalledTimes(1);
  });

  it("rejects a chosen code that fails the format rule before ever touching the database", async () => {
    const result = await createAffiliateSignup(
      programSlug,
      { error: "" },
      formDataWithChosenCode("Sarah", "sarah@example.com", "Not A Valid Code!")
    );

    expect(result.error).toBe(
      "Use lowercase letters, numbers and hyphens, with no hyphen at either end."
    );
    const affiliates = await db.affiliate.findMany({ where: { merchantId } });
    expect(affiliates).toHaveLength(0);
  });
});
