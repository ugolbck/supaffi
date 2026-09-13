// Destructive: clears Merchant and Owner before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";

import { db } from "@/lib/db";
import { GET } from "@/app/track.js/route";
import { REFERRAL_COOKIE } from "@/lib/referral";

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

const DOMAIN = "affiliates.acme.test";

async function clear() {
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedMerchant(domain = DOMAIN) {
  const owner = await db.owner.create({
    data: { email: `track-script-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
  return db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "Acme",
      domain,
      websiteUrl: "https://acme.test",
    },
  });
}

function serve(host: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest("http://c0ffee1234ab:3000/track.js", { headers: { host, ...headers } }));
}

async function script(): Promise<string> {
  await seedMerchant();
  return (await serve(DOMAIN)).text();
}

describe.skipIf(!hasDatabase)("track.js", () => {
  beforeEach(clear);
  afterAll(clear);

  it("writes the cookie under the namespaced name", async () => {
    // The Merchant's own auth provider shares this cookie jar, so the name has
    // to be one nothing else picks by accident.
    expect(await script()).toContain(`"${REFERRAL_COOKIE}="`);
  });

  it("never sends SameSite=None, which would make the cookie cross-site", async () => {
    const code = await script();
    expect(code).toContain("SameSite=Lax");
    expect(code).not.toContain("SameSite=None");
  });

  it("adds Secure at runtime rather than baking it in", async () => {
    // A Secure cookie on a plain-HTTP dev site is dropped with no error, and
    // tracking would fail in a way nobody can see. The script decides on the
    // page it actually runs on, not on the scheme this route was served over.
    const code = await script();
    expect(code).toContain('window.location.protocol === "https:" ? "; Secure" : ""');
  });

  it("bakes in the Merchant's stored domain, not the address this process answers on", async () => {
    // Behind the bundled proxy the server sees its own container address.
    // Baking that in points every Merchant's site at a hostname that only
    // resolves inside the Docker network, and nothing is ever tracked.
    const code = await script();
    expect(code).toContain('"https://affiliates.acme.test/api/track?via="');
    expect(code).not.toContain("c0ffee1234ab");
  });

  it("ignores X-Forwarded-Proto, which a request can set to anything", async () => {
    await seedMerchant();
    const code = await (await serve(DOMAIN, { "x-forwarded-proto": 'x";alert(1);//' })).text();
    expect(code).not.toContain("alert");
    expect(code).toContain('"https://affiliates.acme.test/api/track?via="');
  });

  it("uses http for a local development domain", async () => {
    await seedMerchant("localhost:3600");
    const code = await (await serve("localhost:3600")).text();
    expect(code).toContain('"http://localhost:3600/api/track?via="');
  });

  it("serves nothing for a host that is not a Merchant", async () => {
    await seedMerchant();
    const res = await serve('evil.test";alert(1);//');
    expect(res.status).toBe(404);
  });

  it("can be cached, but never across Merchants", async () => {
    await seedMerchant();
    const res = await serve(DOMAIN);
    expect(res.headers.get("cache-control")).toContain("max-age=");
    expect(res.headers.get("vary")).toBe("Host");
  });
});
