// Destructive: clears Email and Owner. Runs against the scratch DATABASE_URL
// that test/setup.ts enforces, never the dev one.
import { describe, it, expect, beforeEach, afterAll, vi } from "vitest";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";
import { connectMail, disconnectMail, headerSafe, mailErrorText, mailStatus, smtpSettings } from "@/lib/mail";
import { escape, welcomeEmail } from "@/lib/emails";
import { sendDueEmails } from "@/lib/worker/sendEmails";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const INPUT = { host: "SMTP.Resend.com ", port: "465", user: "resend", password: "re_key", from: "Hi@Example.com" };

async function clearAll() {
  await db.email.deleteMany();
  await db.affiliateLoginToken.deleteMany();
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

const newOwner = () => db.owner.create({ data: { email: `o-${crypto.randomUUID()}@example.com`, passwordHash: "x" } });

describe("mail settings", () => {
  beforeEach(clearAll);
  afterAll(async () => {
    await clearAll();
    await db.$disconnect();
  });

  it("saves settings only once a test email went through, password encrypted", async () => {
    const owner = await newOwner();
    const test = vi.fn(async () => {});

    expect(await connectMail(owner.id, INPUT, test)).toEqual({ sentTo: owner.email });
    expect(test).toHaveBeenCalledWith({ host: "smtp.resend.com", port: 465, user: "resend", password: "re_key", from: "hi@example.com" }, owner.email);
    const row = await db.owner.findUniqueOrThrow({ where: { id: owner.id } });
    expect(row.smtpPasswordEnc).not.toContain("re_key");
    expect(decrypt(row.smtpPasswordEnc!)).toBe("re_key");
  });

  it("saves nothing when the test fails, and says why", async () => {
    const owner = await newOwner();
    const refused = Object.assign(new Error("Invalid login"), { code: "EAUTH", responseCode: 535 });

    expect(await connectMail(owner.id, INPUT, async () => Promise.reject(refused))).toEqual({
      error: "The server refused the username or password.",
    });
    expect(await mailStatus(owner.id)).toBeNull();
  });

  it("keeps the stored password when the field is left blank", async () => {
    const owner = await newOwner();
    await connectMail(owner.id, INPUT, async () => {});
    const test = vi.fn(async () => {});

    await connectMail(owner.id, { ...INPUT, from: "new@example.com", password: "" }, test);

    expect(test).toHaveBeenCalledWith(expect.objectContaining({ password: "re_key", from: "new@example.com" }), owner.email);
    expect((await smtpSettings(owner.id))?.password).toBe("re_key");
  });

  it("refuses a malformed server, port or address before trying", async () => {
    const owner = await newOwner();
    const test = vi.fn(async () => {});

    expect(await connectMail(owner.id, { ...INPUT, host: "smtp example" }, test)).toMatchObject({ error: expect.any(String) });
    expect(await connectMail(owner.id, { ...INPUT, port: "70000" }, test)).toMatchObject({ error: expect.any(String) });
    expect(await connectMail(owner.id, { ...INPUT, from: "nobody" }, test)).toMatchObject({ error: expect.any(String) });
    expect(test).not.toHaveBeenCalled();
  });

  it("turns off completely", async () => {
    const owner = await newOwner();
    await connectMail(owner.id, INPUT, async () => {});
    await disconnectMail(owner.id);
    expect(await smtpSettings(owner.id)).toBeNull();
  });

  it("puts errors in words an owner can act on", () => {
    const server = { host: "smtp.x.com", port: 587 };
    expect(mailErrorText(Object.assign(new Error(), { code: "ETIMEDOUT" }), server)).toBe("Could not reach smtp.x.com on port 587.");
    expect(mailErrorText(Object.assign(new Error(), { responseCode: 554 }), server)).toBe("The server refused to send from that address.");
  });

  it("keeps names from starting a new header, and escapes what goes into HTML", () => {
    expect(headerSafe('Evil\r\nBcc: x@y.com "q"')).toBe("Evil Bcc: x@y.com q");
    expect(escape(`<img src=x onerror="a">`)).toBe("&lt;img src=x onerror=&quot;a&quot;&gt;");
    const email = welcomeEmail({ to: "a@b.c", product: "<b>Shop</b>", link: "https://x?via=a", terms: "20% of every payment", href: "https://x" });
    expect(email.html).not.toContain("<b>Shop</b>");
    expect(email.text).toContain("<b>Shop</b>");
  });
});

describe("sending", () => {
  beforeEach(clearAll);

  async function queued(ownerId: string) {
    return db.email.create({
      // Due a minute ago: the database's clock can run a little behind this one.
      data: {
        ownerId,
        dedupeKey: crypto.randomUUID(),
        to: "a@example.com",
        fromName: "Shop",
        subject: "Hi",
        text: "t",
        html: "h",
        nextAttemptAt: new Date(Date.now() - 60_000),
      },
    });
  }

  async function connected() {
    const owner = await newOwner();
    await db.owner.update({
      where: { id: owner.id },
      data: { smtpHost: "smtp.x.com", smtpPort: 587, smtpPasswordEnc: encrypt("p"), mailFrom: "hi@x.com" },
    });
    return owner;
  }

  it("sends what is due and marks it sent", async () => {
    const owner = await connected();
    const email = await queued(owner.id);
    const send = vi.fn(async () => {});

    await sendDueEmails(send);

    expect(send).toHaveBeenCalledWith(expect.objectContaining({ host: "smtp.x.com", password: "p" }), expect.objectContaining({ to: "a@example.com" }));
    expect((await db.email.findUniqueOrThrow({ where: { id: email.id } })).status).toBe("SENT");
  });

  it("retries later, then gives up and tells the owner; one that gets through clears it", async () => {
    const owner = await connected();
    const email = await queued(owner.id);
    const down = vi.fn(async () => Promise.reject(Object.assign(new Error(), { code: "ECONNECTION" })));

    await sendDueEmails(down);
    let row = await db.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(row.status).toBe("PENDING");
    expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    await db.email.update({ where: { id: email.id }, data: { attempts: 5, nextAttemptAt: new Date(Date.now() - 60_000) } });
    await sendDueEmails(down);
    row = await db.email.findUniqueOrThrow({ where: { id: email.id } });
    expect(row.status).toBe("FAILED");
    expect((await mailStatus(owner.id))?.failure?.message).toBe("Could not reach smtp.x.com on port 587.");

    await queued(owner.id);
    await sendDueEmails(vi.fn(async () => {}));
    expect((await mailStatus(owner.id))?.failure).toBeNull();
  });

  it("drops what was queued before email was turned off", async () => {
    const owner = await connected();
    const email = await queued(owner.id);
    await disconnectMail(owner.id);
    const send = vi.fn(async () => {});

    await sendDueEmails(send);

    expect(send).not.toHaveBeenCalled();
    expect((await db.email.findUniqueOrThrow({ where: { id: email.id } })).status).toBe("FAILED");
  });
});
