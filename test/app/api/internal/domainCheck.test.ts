// Destructive: clears Merchant and Owner before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
//
// This endpoint is Caddy's on-demand TLS "ask" (see Caddyfile). A false 2xx
// turns the server into a free certificate mint for any domain pointed at it;
// a false 403 makes a real Merchant's domain unreachable. Neither failure is
// visible from the app itself, which is why this file exists.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { GET } from "@/app/api/internal/domain-check/route";

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
    "Skipping test/app/api/internal/domainCheck.test.ts: no reachable DATABASE_URL. Set DATABASE_URL to a disposable database to run these tests."
  );
}

async function clear() {
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

function ask(domain?: string) {
  const url = domain
    ? `http://app:3000/api/internal/domain-check?domain=${encodeURIComponent(domain)}`
    : "http://app:3000/api/internal/domain-check";
  return GET(new NextRequest(url));
}

// skipIf, not runIf: matches test/app/api/track/route.test.ts and
// test/lib/merchant.test.ts, the other two database-backed suites.
describe.skipIf(!hasDatabase)("domain-check", () => {
  beforeEach(clear);
  afterAll(clear);

  it("refuses a domain it has never seen", async () => {
    const res = await ask("supaffi.example.com");
    expect(res.status).toBe(403);
  });

  it("refuses every domain on a fresh instance, which is why the instance needs its own named site block", async () => {
    const res = await ask("anything.example.com");
    expect(res.status).toBe(403);
  });

  it("rejects a request with no domain at all", async () => {
    const res = await ask();
    expect(res.status).toBe(400);
  });

  it("approves a registered Merchant domain", async () => {
    const owner = await db.owner.create({
      data: { email: "domain-check-owner@example.com", passwordHash: "x" },
    });
    await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "Domain Check",
        domain: "affiliates.example.com",
        websiteUrl: "https://example.com",
      },
    });

    const res = await ask("affiliates.example.com");
    expect(res.status).toBe(200);
  });

  it("refuses a registered domain in the wrong case, since a real SNI arrives lowercase and the stored value is normalized", async () => {
    const owner = await db.owner.create({
      data: { email: "domain-check-case@example.com", passwordHash: "x" },
    });
    await db.merchant.create({
      data: {
        slug: crypto.randomUUID(),
        ownerId: owner.id,
        name: "Domain Check Case",
        domain: "affiliates.example.com",
        websiteUrl: "https://example.com",
      },
    });

    const res = await ask("Affiliates.Example.COM");
    expect(res.status).toBe(403);
  });
});
