// Destructive: clears Merchant and Owner. Point DATABASE_URL at a disposable
// database, never a real deployment's data.
import { describe, it, expect, vi, beforeEach, afterEach, afterAll } from "vitest";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { connectPolarToken } from "@/lib/payments/polar/connectToken";

type Call = { method: string; url: string; token: string };
let calls: Call[];
let merchantId: string;
let ownerId: string;

function answer(status: number, body: unknown = {}) {
  return new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/** A Polar where each token sees only the endpoints made with it. */
function polar(endpoints: Record<string, string>) {
  return vi.fn(async (url: string, init: RequestInit) => {
    const token = (init.headers as Record<string, string>).Authorization.replace("Bearer ", "");
    const method = init.method ?? "GET";
    calls.push({ method, url, token });
    if (url.endsWith("/v1/webhooks/endpoints?limit=1")) return answer(200, { items: [] });
    if (method === "POST") {
      endpoints[`we_${token}`] = token;
      return answer(201, { id: `we_${token}`, url: "u", events: [], secret: `whsec_${token}` });
    }
    const id = decodeURIComponent(url.split("/").at(-1)!);
    if (endpoints[id] !== token) return answer(404, { error: "ResourceNotFound" });
    if (method === "DELETE") return answer(204);
    return answer(200, { id, url: "u", events: [] });
  });
}

beforeEach(async () => {
  calls = [];
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
  const owner = await db.owner.create({ data: { email: `o-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });
  ownerId = owner.id;
  const merchant = await db.merchant.create({
    data: {
      ownerId,
      slug: crypto.randomUUID(),
      name: "Acme",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://acme.example.com",
      paymentProvider: "POLAR",
    },
  });
  merchantId = merchant.id;
});

afterEach(() => vi.unstubAllGlobals());

afterAll(async () => {
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
  await db.$disconnect();
});

const stored = () => db.merchant.findUniqueOrThrow({ where: { id: merchantId } });

describe("connectPolarToken", () => {
  it("creates the webhook with a first token and stores both", async () => {
    vi.stubGlobal("fetch", polar({}));
    expect(await connectPolarToken(ownerId, merchantId, "polar_oat_a")).toEqual({ error: null });
    const m = await stored();
    expect(decrypt(m.paymentKeyEnc!)).toBe("polar_oat_a");
    expect(decrypt(m.webhookSecretEnc!)).toBe("whsec_polar_oat_a");
    expect(m.webhookEndpointId).toBe("we_polar_oat_a");
  });

  it("keeps the webhook when the new token can see it", async () => {
    const endpoints = {};
    vi.stubGlobal("fetch", polar(endpoints));
    await connectPolarToken(ownerId, merchantId, "polar_oat_a");
    // Another token of the same organization sees the same endpoint.
    (endpoints as Record<string, string>).we_polar_oat_a = "polar_oat_a2";
    calls = [];
    await connectPolarToken(ownerId, merchantId, "polar_oat_a2");
    expect(calls.some((c) => c.method === "POST" || c.method === "DELETE")).toBe(false);
    expect((await stored()).webhookEndpointId).toBe("we_polar_oat_a");
  });

  it("moves to a new webhook for a token of another organization, removing the old one with the old token", async () => {
    vi.stubGlobal("fetch", polar({}));
    await connectPolarToken(ownerId, merchantId, "polar_oat_sandbox");
    calls = [];
    await connectPolarToken(ownerId, merchantId, "polar_oat_live");
    expect(calls.filter((c) => c.method !== "GET").map((c) => [c.method, c.token])).toEqual([
      ["POST", "polar_oat_live"],
      ["DELETE", "polar_oat_sandbox"],
    ]);
    const m = await stored();
    expect(m.webhookEndpointId).toBe("we_polar_oat_live");
    expect(decrypt(m.webhookSecretEnc!)).toBe("whsec_polar_oat_live");
  });

  it("leaves a webhook the owner made by hand alone", async () => {
    await db.merchant.update({ where: { id: merchantId }, data: { webhookSecretEnc: encrypt("whsec_own") } });
    vi.stubGlobal("fetch", polar({}));
    await connectPolarToken(ownerId, merchantId, "polar_oat_a");
    expect(calls.some((c) => c.method === "POST")).toBe(false);
    expect(decrypt((await stored()).webhookSecretEnc!)).toBe("whsec_own");
  });

  it("stores nothing when the token is refused", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => answer(401)));
    expect((await connectPolarToken(ownerId, merchantId, "polar_oat_bad")).error).toBeTruthy();
    expect((await stored()).paymentKeyEnc).toBeNull();
  });
});
