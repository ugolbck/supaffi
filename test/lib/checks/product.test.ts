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

const ALL_SECTIONS = new Set(["dns", "stripe", "email", "tracking"] as const);

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

    const webhookArgs: string[][] = [];
    const result = await runProductChecks(owner.id, merchant.id, {
      overrides: {
        resolvesTo: async () => ok,
        httpsReachable: async () => ({ reachable: ok, certificate: no }),
        stripeKeyWorks: async () => ok,
        webhookEventReceived: async (ownerId: string, merchantId: string) => {
          webhookArgs.push([ownerId, merchantId]);
          return no;
        },
        resendKeyWorks: async () => ok,
        sendingDomainVerified: async () => ok,
        scriptFound: async () => no,
      },
    });

    expect(result.dns.resolves.ok).toBe(true);
    expect(result.dns.certificate.ok).toBe(false);
    // No Stripe key on file, so the key check is not run and reads as not connected.
    expect(result.stripe.key.ok).toBe(false);
    expect(result.stripe.key.detail).toMatch(/not connected/i);
    expect(result.email.key.detail).toMatch(/not connected/i);
    expect(result.tracking.script.ok).toBe(false);
    // The webhook check is owner-scoped, so it has to be handed the owner.
    expect(webhookArgs).toEqual([[owner.id, merchant.id]]);

    await connectStripe(owner.id, merchant.id, { secretKey: "rk_test_1", webhookSecret: "whsec_1" });
    await connectEmailProvider(owner.id, merchant.id, "re_1");
    // Credentials that were not there a moment ago, so every section is asked
    // for fresh rather than served from the run above.
    const after = await runProductChecks(owner.id, merchant.id, {
      fresh: ALL_SECTIONS,
      overrides: {
        resolvesTo: async () => ok,
        httpsReachable: async () => ({ reachable: ok, certificate: ok }),
        stripeKeyWorks: async () => ok,
        webhookEventReceived: async () => ok,
        resendKeyWorks: async () => ok,
        sendingDomainVerified: async () => ok,
        scriptFound: async () => ok,
      },
    });
    expect(after.stripe.key.ok).toBe(true);
    expect(after.email.domain.ok).toBe(true);
  });

  it("runs every section on a cold cache and only the named ones on a warm one", async () => {
    const owner = await db.owner.create({ data: { email: "c@example.com", passwordHash: "x" } });
    const merchant = await createMerchant(owner.id, {
      name: "C",
      domain: "affiliates.c.test",
      websiteUrl: "https://c.test",
    });
    await connectStripe(owner.id, merchant.id, { secretKey: "rk_test_1", webhookSecret: "whsec_1" });
    await connectEmailProvider(owner.id, merchant.id, "re_1");
    process.env.SUPAFFI_HOST_IP = "146.59.195.140";

    const calls: string[] = [];
    const overrides = {
      resolvesTo: async () => {
        calls.push("resolvesTo");
        return ok;
      },
      httpsReachable: async () => {
        calls.push("httpsReachable");
        return { reachable: ok, certificate: ok };
      },
      stripeKeyWorks: async () => {
        calls.push("stripeKeyWorks");
        return ok;
      },
      webhookEventReceived: async () => {
        calls.push("webhookEventReceived");
        return ok;
      },
      resendKeyWorks: async () => {
        calls.push("resendKeyWorks");
        return no;
      },
      sendingDomainVerified: async () => {
        calls.push("sendingDomainVerified");
        return no;
      },
      scriptFound: async () => {
        calls.push("scriptFound");
        return ok;
      },
    };

    // Cold: this product has never been checked in this process.
    await runProductChecks(owner.id, merchant.id, { fresh: new Set(["email"] as const), overrides });
    expect(calls.sort()).toEqual([
      "httpsReachable",
      "resendKeyWorks",
      "resolvesTo",
      "scriptFound",
      "sendingDomainVerified",
      "stripeKeyWorks",
      "webhookEventReceived",
    ]);

    // Warm: only the email section is asked for fresh, so only it runs, and
    // the other three lights come back exactly as they were.
    calls.length = 0;
    const warm = await runProductChecks(owner.id, merchant.id, {
      fresh: new Set(["email"] as const),
      overrides: {
        ...overrides,
        resendKeyWorks: async () => {
          calls.push("resendKeyWorks");
          return ok;
        },
        sendingDomainVerified: async () => {
          calls.push("sendingDomainVerified");
          return ok;
        },
      },
    });
    expect(calls.sort()).toEqual(["resendKeyWorks", "sendingDomainVerified"]);
    expect(warm.email.key.ok).toBe(true);
    expect(warm.dns.resolves.ok).toBe(true);
    expect(warm.tracking.script.ok).toBe(true);

    // Nothing named fresh at all: nothing runs.
    calls.length = 0;
    await runProductChecks(owner.id, merchant.id, { overrides });
    expect(calls).toEqual([]);
  });

  it("expires each section on its own clock, so polling one does not keep the rest alive", async () => {
    const owner = await db.owner.create({ data: { email: "c@example.com", passwordHash: "x" } });
    const merchant = await createMerchant(owner.id, {
      name: "C",
      domain: "affiliates.c.test",
      websiteUrl: "https://c.test",
    });
    await connectStripe(owner.id, merchant.id, { secretKey: "rk_test_1", webhookSecret: "whsec_1" });
    await connectEmailProvider(owner.id, merchant.id, "re_1");
    process.env.SUPAFFI_HOST_IP = "146.59.195.140";

    const calls: string[] = [];
    const overrides = {
      resolvesTo: async () => {
        calls.push("resolvesTo");
        return ok;
      },
      httpsReachable: async () => {
        calls.push("httpsReachable");
        return { reachable: ok, certificate: ok };
      },
      stripeKeyWorks: async () => {
        calls.push("stripeKeyWorks");
        return ok;
      },
      webhookEventReceived: async () => {
        calls.push("webhookEventReceived");
        return ok;
      },
      resendKeyWorks: async () => {
        calls.push("resendKeyWorks");
        return ok;
      },
      sendingDomainVerified: async () => {
        calls.push("sendingDomainVerified");
        return ok;
      },
      scriptFound: async () => {
        calls.push("scriptFound");
        return ok;
      },
    };
    const email = new Set(["email"] as const);

    let clock = 1_000_000;
    const now = () => clock;

    // Warms every section.
    await runProductChecks(owner.id, merchant.id, { fresh: email, overrides, now });

    // Still inside the minute: only the email section runs.
    calls.length = 0;
    clock += 30_000;
    await runProductChecks(owner.id, merchant.id, { fresh: email, overrides, now });
    expect(calls.sort()).toEqual(["resendKeyWorks", "sendingDomainVerified"]);

    // Sixty-one seconds after the first run. The email section has been asked
    // for on every poll, but the other three have not been run since, so they
    // are stale and run again rather than living forever on the email poll.
    calls.length = 0;
    clock += 31_000;
    await runProductChecks(owner.id, merchant.id, { fresh: email, overrides, now });
    expect(calls.sort()).toEqual([
      "httpsReachable",
      "resendKeyWorks",
      "resolvesTo",
      "scriptFound",
      "sendingDomainVerified",
      "stripeKeyWorks",
      "webhookEventReceived",
    ]);
  });

  it("degrades one failing check to its own failed result instead of losing every light", async () => {
    const owner = await db.owner.create({ data: { email: "c@example.com", passwordHash: "x" } });
    const merchant = await createMerchant(owner.id, {
      name: "C",
      domain: "affiliates.c.test",
      websiteUrl: "https://c.test",
    });
    process.env.SUPAFFI_HOST_IP = "146.59.195.140";

    const result = await runProductChecks(owner.id, merchant.id, {
      overrides: {
        resolvesTo: async () => ok,
        httpsReachable: async () => ({ reachable: ok, certificate: ok }),
        stripeKeyWorks: async () => ok,
        webhookEventReceived: async () => {
          throw new Error("db down");
        },
        resendKeyWorks: async () => ok,
        sendingDomainVerified: async () => ok,
        scriptFound: async () => ok,
      },
    });

    expect(result.dns.resolves.ok).toBe(true);
    expect(result.stripe.webhook.ok).toBe(false);
    expect(result.stripe.webhook.detail).toBeTruthy();
  });
});
