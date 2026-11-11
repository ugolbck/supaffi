// Destructive: clears Owner and Merchant rows. Runs only against a database
// whose name ends in _test (see test/setup.ts).
//
// The functions a build may call. Each keeps an Owner to their own data.
import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import { db } from "@/lib/db";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(), signIn: vi.fn() }));
vi.mock("@/extensions/installed-static", () => ({ installedStatic: { owners: { signupPath: "/signup" } } }));

import { auth, signIn } from "@/lib/auth";
import { verifyOwnerCredentials } from "@/lib/owner";
import { ownerSessionIsCurrent } from "@/lib/ownerExists";
import {
  createOwnerAccount,
  currentOwnerId,
  findOwnerByEmail,
  isMerchantDomain,
  listOwnerMerchants,
  setOwnerPassword,
  signInOwner,
} from "@/extensions/core-api";

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

const PASSWORD = "correct horse battery staple";

async function merchantFor(ownerId: string, name: string) {
  return db.merchant.create({
    data: { ownerId, name, slug: name.toLowerCase(), domain: `affiliates.${name.toLowerCase()}.com`, websiteUrl: `https://${name.toLowerCase()}.com` },
  });
}

describe.skipIf(!hasDatabase)("core API", () => {
  beforeEach(async () => {
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
  });

  afterAll(async () => {
    await db.merchant.deleteMany();
    await db.owner.deleteMany();
    await db.$disconnect();
  });

  it("creates Owners and finds them by email, case aside", async () => {
    const { ownerId } = await createOwnerAccount({ email: "Ann@example.com", password: PASSWORD });
    expect(await findOwnerByEmail("ANN@example.com")).toEqual({ ownerId });
    expect(await findOwnerByEmail("nobody@example.com")).toBeNull();
  });

  it("refuses an email that is taken", async () => {
    await createOwnerAccount({ email: "ann@example.com", password: PASSWORD });
    await expect(createOwnerAccount({ email: "ann@example.com", password: PASSWORD })).rejects.toThrow();
  });

  it("sets a password without the old one, for that Owner only", async () => {
    const ann = await createOwnerAccount({ email: "ann@example.com", password: PASSWORD });
    await createOwnerAccount({ email: "bob@example.com", password: PASSWORD });
    await setOwnerPassword(ann.ownerId, "a brand new passphrase");
    expect(await verifyOwnerCredentials("ann@example.com", "a brand new passphrase")).not.toBeNull();
    expect(await verifyOwnerCredentials("bob@example.com", PASSWORD)).not.toBeNull();
  });

  it("ends sessions from before the reset, and keeps one signed in the same second", async () => {
    const { ownerId } = await createOwnerAccount({ email: "ann@example.com", password: PASSWORD });
    const before = Math.floor(Date.now() / 1000) - 60;
    await setOwnerPassword(ownerId, "a brand new passphrase");
    expect(await ownerSessionIsCurrent(ownerId, before)).toBe(false);
    expect(await ownerSessionIsCurrent(ownerId, Math.floor(Date.now() / 1000))).toBe(true);
  });

  it("lists only the Owner's own merchants", async () => {
    const ann = await createOwnerAccount({ email: "ann@example.com", password: PASSWORD });
    const bob = await createOwnerAccount({ email: "bob@example.com", password: PASSWORD });
    const acme = await merchantFor(ann.ownerId, "Acme");
    await merchantFor(bob.ownerId, "Bobco");
    expect(await listOwnerMerchants(ann.ownerId)).toEqual([{ id: acme.id, name: "Acme", domain: "affiliates.acme.com" }]);
  });

  it("tells a product's domain from the dashboard's", async () => {
    const ann = await createOwnerAccount({ email: "ann@example.com", password: PASSWORD });
    await merchantFor(ann.ownerId, "Acme");
    expect(await isMerchantDomain("AFFILIATES.acme.com")).toBe(true);
    expect(await isMerchantDomain("app.example.com")).toBe(false);
    expect(await isMerchantDomain(null)).toBe(false);
  });
});

describe("core API input checks", () => {
  it("refuses a malformed email or a short password before touching the database", async () => {
    await expect(createOwnerAccount({ email: "not-an-email", password: PASSWORD })).rejects.toThrow("email");
    await expect(createOwnerAccount({ email: "ann@example.com", password: "short" })).rejects.toThrow("characters");
    await expect(setOwnerPassword("owner-1", "short")).rejects.toThrow("characters");
  });
});

describe("core API sessions", () => {
  it("returns the Owner's id only for an Owner session", async () => {
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "o1", role: "owner" } } as never);
    expect(await currentOwnerId()).toBe("o1");
    vi.mocked(auth).mockResolvedValueOnce({ user: { id: "a1", role: "affiliate" } } as never);
    expect(await currentOwnerId()).toBeNull();
    vi.mocked(auth).mockResolvedValueOnce(null as never);
    expect(await currentOwnerId()).toBeNull();
  });

  it("signs in through the Owner credentials provider", async () => {
    await signInOwner({ email: "ann@example.com", password: PASSWORD, redirectTo: "/dashboard" });
    expect(signIn).toHaveBeenCalledWith("credentials", { email: "ann@example.com", password: PASSWORD, redirectTo: "/dashboard" });
  });
});
