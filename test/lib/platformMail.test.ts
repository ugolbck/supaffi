// mail.platformServer: a product without its own mail server sends through
// the platform's. Destructive: clears Email / AffiliateLoginToken / Commission /
// Click / AffiliateLink / Affiliate / Program / Merchant / Owner. Runs against
// the scratch DATABASE_URL that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from "vitest";
import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import { clearReferralTables, seedMerchant, seedOwner, seedReferral } from "./worker/referralFixtures";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const PLATFORM = { host: "mail.platform.test", port: 587, user: "platform", password: "pw", from: "Notify@Platform.test" };

async function clearAll() {
  await db.email.deleteMany();
  await db.affiliateLoginToken.deleteMany();
  await clearReferralTables();
}

function install(platformServer: object | null) {
  vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { mail: { platformServer } } }));
}

async function load() {
  return {
    mail: await import("@/lib/mail"),
    notify: await import("@/lib/notify"),
    worker: await import("@/lib/worker/sendEmails"),
  };
}

async function product() {
  const owner = await seedOwner();
  return { owner, merchant: await seedMerchant(owner.id) };
}

async function withOwnServer(merchantId: string) {
  return db.merchant.update({
    where: { id: merchantId },
    data: { smtpHost: "smtp.own.test", smtpPort: 465, smtpUser: "me", smtpPasswordEnc: encrypt("own"), mailFrom: "hi@own.test" },
  });
}

async function queued(merchantId: string) {
  return db.email.create({
    data: {
      merchantId,
      dedupeKey: crypto.randomUUID(),
      to: "a@example.com",
      fromName: "Product",
      subject: "Hi",
      text: "t",
      html: "h",
      nextAttemptAt: new Date(Date.now() - 60_000),
    },
  });
}

async function sentEarlier(merchantId: string, hoursAgo: number) {
  const at = new Date(Date.now() - hoursAgo * 60 * 60_000);
  return db.email.create({
    data: { merchantId, dedupeKey: crypto.randomUUID(), to: "a@example.com", fromName: "P", subject: "s", text: "", html: "", status: "SENT", sentAt: at, sentByPlatform: true },
  });
}

beforeEach(async () => {
  vi.resetModules();
  vi.doUnmock("@/extensions/installed-static");
  await clearAll();
});

afterAll(async () => {
  vi.doUnmock("@/extensions/installed-static");
  await clearAll();
  await db.$disconnect();
});

describe("without a platform server", () => {
  it("keeps email off for a product with no server of its own", async () => {
    const { mail, notify, worker } = await load();
    const { merchant } = await product();
    const { affiliate } = await seedReferral(merchant);
    const email = await queued(merchant.id);
    const send = vi.fn(async () => {});

    expect(await mail.productHasEmail(merchant.id)).toBe(false);
    expect(await mail.smtpSettings(merchant.id)).toBeNull();
    expect(await mail.mailStatus(merchant.ownerId, merchant.id)).toBeNull();
    expect(await notify.emailPasswordLink(affiliate.id)).toBe(false);
    await worker.sendDueEmails(send);
    expect(send).not.toHaveBeenCalled();
    expect(await db.email.findUniqueOrThrow({ where: { id: email.id } })).toMatchObject({ status: "FAILED", lastError: "Email is off" });
  });

  it("sends through the product's own server exactly as before", async () => {
    const { mail, worker } = await load();
    const merchant = await withOwnServer((await product()).merchant.id);
    await queued(merchant.id);
    const send = vi.fn(async () => {});

    expect(await mail.smtpSettings(merchant.id)).toEqual({ host: "smtp.own.test", port: 465, user: "me", password: "own", from: "hi@own.test" });
    await worker.sendDueEmails(send);
    const [, email] = send.mock.calls[0] as unknown as [unknown, Record<string, unknown>];
    expect(email).not.toHaveProperty("replyTo");
    expect(await db.email.findFirstOrThrow()).toMatchObject({ status: "SENT", sentByPlatform: false });
    expect(await mail.mailStatus(merchant.ownerId, merchant.id)).toMatchObject({ via: "own", fallback: false, waiting: false });
  });
});

describe("with a platform server", () => {
  beforeEach(() => install(PLATFORM));

  it("turns email on for a product with no server of its own", async () => {
    const { mail } = await load();
    const { owner, merchant } = await product();

    expect(await mail.productHasEmail(merchant.id)).toBe(true);
    expect(await mail.productMail(merchant.id)).toMatchObject({ ownerEmail: owner.email, emailAffiliates: true });
    expect(await mail.smtpSettings(merchant.id)).toEqual({
      host: "mail.platform.test",
      port: 587,
      user: "platform",
      password: "pw",
      from: "notify@platform.test",
      platform: { ownerId: owner.id, replyTo: owner.email, dailyLimit: null },
    });
    expect(await mail.mailStatus(owner.id, merchant.id)).toMatchObject({ via: "platform", product: "Product", replyTo: owner.email, waiting: false });
  });

  it("keeps using the product's own server when it has one", async () => {
    const { mail, worker } = await load();
    const merchant = await withOwnServer((await product()).merchant.id);
    await queued(merchant.id);
    const send = vi.fn(async () => {});

    expect((await mail.smtpSettings(merchant.id))?.host).toBe("smtp.own.test");
    expect(await mail.smtpSettings(merchant.id)).not.toHaveProperty("platform");
    expect(await mail.mailStatus(merchant.ownerId, merchant.id)).toMatchObject({ via: "own", from: "hi@own.test", fallback: true });
    await worker.sendDueEmails(send);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.own.test" }), expect.not.objectContaining({ replyTo: expect.anything() }));
  });

  it("falls back to the platform server when the product's own is removed", async () => {
    const { mail } = await load();
    const merchant = await withOwnServer((await product()).merchant.id);
    await mail.disconnectMail(merchant.ownerId, merchant.id);

    expect((await mail.smtpSettings(merchant.id))?.host).toBe("mail.platform.test");
  });

  it("sends from the platform's address under the product's name, replies to the Owner", async () => {
    const { worker } = await load();
    const { owner, merchant } = await product();
    await queued(merchant.id);
    const send = vi.fn(async () => {});

    await worker.sendDueEmails(send);

    expect(send).toHaveBeenCalledWith(
      expect.objectContaining({ from: "notify@platform.test", platform: expect.objectContaining({ replyTo: owner.email }) }),
      expect.objectContaining({ fromName: "Product", to: "a@example.com", replyTo: owner.email })
    );
    expect(await db.email.findFirstOrThrow()).toMatchObject({ status: "SENT", sentByPlatform: true });
  });

  it("emails a password link with no setup", async () => {
    const { notify } = await load();
    const { merchant } = await product();
    const { affiliate } = await seedReferral(merchant);

    expect(await notify.emailPasswordLink(affiliate.id)).toBe(true);
    expect((await db.email.findFirstOrThrow()).text).toMatch(/\/affiliates\/password\?token=/);
  });

  it("does not show a platform failure's details to the Owner", async () => {
    const { mail } = await load();
    const settings = { host: "mail.platform.test", port: 587, platform: { ownerId: "o", replyTo: "o@x.co", dailyLimit: null } };
    expect(mail.mailErrorText(Object.assign(new Error(), { code: "ETIMEDOUT" }), settings)).toBe("The email could not be sent through our mail server.");
  });
});

describe("the Owner's daily limit", () => {
  beforeEach(() => install({ ...PLATFORM, dailyLimitPerOwner: 2 }));

  it("holds emails in the queue once the Owner's products sent the limit, and says so", async () => {
    const { mail, worker } = await load();
    const { owner, merchant } = await product();
    const other = await seedMerchant(owner.id);
    await sentEarlier(other.id, 1);
    await sentEarlier(other.id, 30); // outside the 24 hours
    const first = await queued(merchant.id);
    const second = await queued(merchant.id);
    const send = vi.fn(async () => {});

    await worker.sendDueEmails(send);

    expect(send).toHaveBeenCalledTimes(1);
    const held = await db.email.findUniqueOrThrow({ where: { id: second.id } });
    expect(held).toMatchObject({ status: "PENDING", attempts: 0, lastError: mail.DAILY_LIMIT_ERROR });
    expect(held.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
    expect(held.text).toBe("t");
    expect((await db.email.findUniqueOrThrow({ where: { id: first.id } })).status).toBe("SENT");
    expect(await mail.mailStatus(owner.id, merchant.id)).toMatchObject({ waiting: true, failure: null });
    expect(await mail.mailStatus(owner.id, other.id)).toMatchObject({ waiting: false });
  });

  it("counts only this Owner's sends through the platform server", async () => {
    const { worker } = await load();
    const { merchant } = await product();
    const stranger = await product();
    await sentEarlier(stranger.merchant.id, 1);
    await sentEarlier(stranger.merchant.id, 1);
    const own = await withOwnServer((await seedMerchant(merchant.ownerId)).id);
    await db.email.create({
      data: { merchantId: own.id, dedupeKey: "own", to: "a@example.com", fromName: "P", subject: "s", text: "", html: "", status: "SENT", sentAt: new Date() },
    });
    await queued(merchant.id);
    await queued(merchant.id);
    const send = vi.fn(async () => {});

    await worker.sendDueEmails(send);

    expect(send).toHaveBeenCalledTimes(2);
  });

  it("does not hold back a product sending through its own server", async () => {
    const { worker } = await load();
    const { merchant } = await product();
    await sentEarlier(merchant.id, 1);
    await sentEarlier(merchant.id, 1);
    await withOwnServer(merchant.id);
    await queued(merchant.id);
    const send = vi.fn(async () => {});

    await worker.sendDueEmails(send);

    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("internal addresses", () => {
  const createTransport = vi.fn();
  const lookup = vi.fn();
  const EMAIL = { to: "a@example.com", fromName: "Acme", subject: "Hi", text: "t", html: "<p>t</p>", replyTo: "owner@example.com" };

  beforeEach(() => {
    createTransport.mockReset();
    createTransport.mockReturnValue({ sendMail: vi.fn(async () => ({})) });
    lookup.mockReset();
    vi.doMock("nodemailer", () => ({ default: { createTransport } }));
    vi.doMock("node:dns/promises", async (original) => ({ ...(await original<object>()), lookup }));
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { outbound: { blockPrivateAddresses: true }, mail: { platformServer: { ...PLATFORM, host: "127.0.0.1" } } },
    }));
  });

  afterEach(() => {
    vi.doUnmock("nodemailer");
    vi.doUnmock("node:dns/promises");
  });

  it("are not refused for the platform server, which gets the Reply-To", async () => {
    const { mail } = await load();
    const { merchant } = await product();
    const settings = (await mail.smtpSettings(merchant.id))!;

    await mail.sendWith(settings, EMAIL);

    expect(lookup).not.toHaveBeenCalled();
    expect(createTransport.mock.calls[0][0].host).toBe("127.0.0.1");
    const message = createTransport.mock.results[0].value.sendMail.mock.calls[0][0];
    expect(message).toMatchObject({ from: { name: "Acme", address: "notify@platform.test" }, replyTo: "owner@example.com" });
  });

  it("are still refused for a product's own server", async () => {
    const { mail } = await load();
    const merchant = await db.merchant.update({
      where: { id: (await product()).merchant.id },
      data: { smtpHost: "127.0.0.1", smtpPort: 587, mailFrom: "hi@own.test" },
    });
    const settings = (await mail.smtpSettings(merchant.id))!;

    await expect(mail.sendWith(settings, EMAIL)).rejects.toThrow("private network");
    expect(createTransport).not.toHaveBeenCalled();
  });

  it("refuse a Reply-To that is not one address", async () => {
    const { mail } = await load();
    await expect(mail.sendWith({ ...PLATFORM, platform: { ownerId: "o", replyTo: "x", dailyLimit: null } }, { ...EMAIL, replyTo: "a@b.co, c@d.co" })).rejects.toMatchObject({
      code: "EENVELOPE",
    });
  });
});
