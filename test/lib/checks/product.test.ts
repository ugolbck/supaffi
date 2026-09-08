import { describe, it, expect, beforeEach, afterEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { createMerchant, connectStripe, connectEmailProvider } from "@/lib/merchant";
import { runProductChecks } from "@/lib/checks/product";

// Skip this whole suite cleanly when no database is reachable, instead of
// letting Prisma throw an opaque connection error mid-run. Checked once, up
// front, via a real connection attempt (not just "is DATABASE_URL set") so a
// stale/unreachable URL also skips rather than failing the suite.
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
    "Skipping test/lib/checks/product.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

const ok = { ok: true, detail: "ok" };
const no = { ok: false, detail: "no" };

describe.skipIf(!hasDatabase)("runProductChecks", () => {
  let previousHostIp: string | undefined;

  beforeEach(async () => {
    await db.merchant.deleteMany({ where: { domain: "affiliates.c.test" } });
    await db.owner.deleteMany({ where: { email: "c@example.com" } });
    previousHostIp = process.env.SUPAFFI_HOST_IP;
  });

  afterEach(() => {
    if (previousHostIp === undefined) delete process.env.SUPAFFI_HOST_IP;
    else process.env.SUPAFFI_HOST_IP = previousHostIp;
  });

  afterAll(async () => {
    await db.merchant.deleteMany({ where: { domain: "affiliates.c.test" } });
    await db.owner.deleteMany({ where: { email: "c@example.com" } });
    await db.$disconnect();
  });

  it("reports every light from injected checks and skips credentials that are not on file", async () => {
    const owner = await db.owner.create({ data: { email: "c@example.com", passwordHash: "x" } });
    const merchant = await createMerchant(owner.id, {
      name: "C",
      domain: "affiliates.c.test",
      websiteUrl: "https://c.test",
    });
    process.env.SUPAFFI_HOST_IP = "146.59.195.140";

    const result = await runProductChecks(owner.id, merchant.id, {
      resolvesTo: async () => ok,
      httpsReachable: async () => ({ reachable: ok, certificate: no }),
      stripeKeyWorks: async () => ok,
      webhookEventReceived: async () => no,
      resendKeyWorks: async () => ok,
      sendingDomainVerified: async () => ok,
      scriptFound: async () => no,
    });

    expect(result.dns.resolves.ok).toBe(true);
    expect(result.dns.certificate.ok).toBe(false);
    // No Stripe key on file, so the key check is not run and reads as not connected.
    expect(result.stripe.key.ok).toBe(false);
    expect(result.stripe.key.detail).toMatch(/not connected/i);
    expect(result.email.key.detail).toMatch(/not connected/i);
    expect(result.tracking.script.ok).toBe(false);

    await connectStripe(owner.id, merchant.id, { secretKey: "rk_test_1", webhookSecret: "whsec_1" });
    await connectEmailProvider(owner.id, merchant.id, "re_1");
    const after = await runProductChecks(owner.id, merchant.id, {
      resolvesTo: async () => ok,
      httpsReachable: async () => ({ reachable: ok, certificate: ok }),
      stripeKeyWorks: async () => ok,
      webhookEventReceived: async () => ok,
      resendKeyWorks: async () => ok,
      sendingDomainVerified: async () => ok,
      scriptFound: async () => ok,
    });
    expect(after.stripe.key.ok).toBe(true);
    expect(after.email.domain.ok).toBe(true);
  });
});
