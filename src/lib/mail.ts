import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * A product's own mail server, reached over SMTP. Per product, like its
 * Stripe key: each one has its own domain, and its affiliates should hear
 * from an address on it, which providers only send from once that domain is
 * verified with them. One transport covers every provider an Owner is likely
 * to use (Resend, Brevo, Amazon SES, Postmark, Gmail Workspace all take SMTP),
 * so there is no second way of sending to keep working. Supaffi never sends
 * from the host itself: a VPS sending direct is blocked or lands in spam.
 *
 * Email is off until the Owner saves settings that pass a test send, and
 * nothing is queued while it is off.
 */

export type SmtpSettings = { host: string; port: number; user: string; password: string; from: string };

/** What queueing needs to know. No password: that is read only to send. */
export type ProductMail = {
  ownerEmail: string;
  notifyNewAffiliates: boolean;
  notifyNewSales: boolean;
  emailAffiliates: boolean;
};

const MAIL_SELECT = {
  smtpHost: true,
  smtpPort: true,
  smtpUser: true,
  smtpPasswordEnc: true,
  mailFrom: true,
  notifyNewAffiliates: true,
  notifyNewSales: true,
  emailAffiliates: true,
  owner: { select: { email: true } },
} as const;

type MailRow = Prisma.MerchantGetPayload<{ select: typeof MAIL_SELECT }>;

function isOn(row: MailRow | null): row is MailRow & { smtpHost: string; smtpPort: number; mailFrom: string } {
  return Boolean(row?.smtpHost && row.smtpPort && row.mailFrom);
}

type MerchantReader = { merchant: { findUnique: typeof db.merchant.findUnique } };

/** The product's mail switches and the Owner's address, or null while email is off. */
export async function productMail(merchantId: string, client: MerchantReader = db): Promise<ProductMail | null> {
  const row = await client.merchant.findUnique({ where: { id: merchantId }, select: MAIL_SELECT });
  if (!isOn(row)) return null;
  return {
    ownerEmail: row.owner.email,
    notifyNewAffiliates: row.notifyNewAffiliates,
    notifyNewSales: row.notifyNewSales,
    emailAffiliates: row.emailAffiliates,
  };
}

/** The server to send through, password decrypted, or null while email is off. */
export async function smtpSettings(merchantId: string): Promise<SmtpSettings | null> {
  const row = await db.merchant.findUnique({ where: { id: merchantId }, select: MAIL_SELECT });
  if (!isOn(row)) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser ?? "",
    password: row.smtpPasswordEnc ? decrypt(row.smtpPasswordEnc) : "",
    from: row.mailFrom,
  };
}

/** Whether the product has email on, for the screens that change with it. */
export async function productHasEmail(merchantId: string): Promise<boolean> {
  return isOn(await db.merchant.findUnique({ where: { id: merchantId }, select: MAIL_SELECT }));
}

// Short enough that a test send in the settings answers while the Owner is
// still looking at it, long enough for a slow provider's greeting.
const TIMEOUTS = { connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 20_000 };

export function transportFor(settings: SmtpSettings) {
  return nodemailer.createTransport({
    host: settings.host,
    port: settings.port,
    // 465 is TLS from the first byte. Every other port starts in the clear
    // and upgrades with STARTTLS, which nodemailer does whenever the server
    // offers it.
    secure: settings.port === 465,
    // A password never crosses the network in the clear: with one to send,
    // a server that does not offer STARTTLS, or someone stripping it on the
    // way, is refused rather than sent to.
    requireTLS: settings.port !== 465 && Boolean(settings.user),
    auth: settings.user ? { user: settings.user, pass: settings.password } : undefined,
    // Messages are built here from text, never from a path or a URL.
    disableFileAccess: true,
    disableUrlAccess: true,
    ...TIMEOUTS,
  });
}

/** A display name with nothing in it that could start a new header line. */
export function headerSafe(value: string): string {
  return value.replace(/[\r\n\t"<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
}

export type OutgoingEmail = { to: string; fromName: string; subject: string; text: string; html: string };

const EMAIL = /^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/;

/** One plain address, nothing nodemailer could read as a list. */
export function isSingleAddress(value: string): boolean {
  return value.length <= 254 && EMAIL.test(value);
}

export async function sendWith(settings: SmtpSettings, email: OutgoingEmail): Promise<void> {
  if (!isSingleAddress(email.to)) throw Object.assign(new Error("Not a single address"), { code: "EENVELOPE" });
  await transportFor(settings).sendMail({
    from: { name: headerSafe(email.fromName), address: settings.from },
    to: email.to,
    subject: email.subject.replace(/[\r\n]+/g, " "),
    text: email.text,
    html: email.html,
  });
}

/**
 * What went wrong, in words an Owner can act on. nodemailer's own messages
 * carry the server's reply, which is useful in a log and noise on a screen.
 */
export function mailErrorText(err: unknown, settings: Pick<SmtpSettings, "host" | "port">): string {
  const { code, responseCode } = (err ?? {}) as { code?: string; responseCode?: number };
  if (code === "EAUTH" || responseCode === 535) return "The server refused the username or password.";
  if (code === "ESOCKET" && /certificate|SSL|TLS/i.test(String((err as Error).message))) {
    return `Could not start a secure connection with ${settings.host}. Check the port.`;
  }
  if (code === "ECONNECTION" || code === "ETIMEDOUT" || code === "ESOCKET" || code === "EDNS") {
    return `Could not reach ${settings.host} on port ${settings.port}.`;
  }
  if (code === "EENVELOPE" || responseCode === 550 || responseCode === 553 || responseCode === 554) {
    return "The server refused to send from that address.";
  }
  return "The email could not be sent.";
}

export type MailSettingsInput = { host: string; port: string; user: string; password: string; from: string };

const HOST = /^[a-z0-9.-]{1,253}$/i;

/** The product, if this Owner has it. Every write below goes through it. */
async function ownedProduct(ownerId: string, merchantId: string) {
  return db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true, name: true, smtpHost: true, smtpUser: true, smtpPasswordEnc: true, owner: { select: { email: true } } },
  });
}

/**
 * Checks the settings by sending a test email to the Owner, and saves them
 * only when it arrives at the server. Settings that cannot send are never
 * saved, so email is either working or off. A blank password keeps the
 * stored one for the same server and account, so editing the address does not
 * mean typing it again.
 */
export async function connectMail(
  ownerId: string,
  merchantId: string,
  input: MailSettingsInput,
  test: (settings: SmtpSettings, to: string, product: string) => Promise<void>
): Promise<{ error: string } | { sentTo: string }> {
  const host = input.host.trim().toLowerCase();
  const port = Number(input.port.trim() || "587");
  const user = input.user.trim();
  const from = input.from.trim().toLowerCase();
  if (!HOST.test(host)) return { error: "Enter the server's address, like smtp.resend.com" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Enter a port between 1 and 65535" };
  if (!isSingleAddress(from)) return { error: "Enter the address emails come from" };

  const product = await ownedProduct(ownerId, merchantId);
  if (!product) return { error: "Product not found" };
  // The stored password is only kept for the server and account it belongs
  // to, never handed to a different one.
  const sameAccount = product.smtpHost === host && (product.smtpUser ?? "") === user;
  if (!input.password && user && !(sameAccount && product.smtpPasswordEnc)) return { error: "Enter the password" };
  const password = input.password || (sameAccount && product.smtpPasswordEnc ? decrypt(product.smtpPasswordEnc) : "");
  const settings = { host, port, user, password, from };

  try {
    await test(settings, product.owner.email, product.name);
  } catch (err) {
    return { error: mailErrorText(err, settings) };
  }

  await db.merchant.update({
    where: { id: product.id },
    data: {
      smtpHost: host,
      smtpPort: port,
      smtpUser: user || null,
      smtpPasswordEnc: password ? encrypt(password) : null,
      mailFrom: from,
      emailFailure: null,
      emailFailedAt: null,
    },
  });
  return { sentTo: product.owner.email };
}

/** Turns email off. Anything still queued is dropped by the worker unsent. */
export async function disconnectMail(ownerId: string, merchantId: string): Promise<void> {
  await db.merchant.updateMany({
    where: { id: merchantId, ownerId },
    data: { smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEnc: null, mailFrom: null, emailFailure: null, emailFailedAt: null },
  });
}

export const MAIL_SWITCHES = ["notifyNewAffiliates", "notifyNewSales", "emailAffiliates"] as const;
export type MailSwitch = (typeof MAIL_SWITCHES)[number];

export async function setMailSwitch(ownerId: string, merchantId: string, name: MailSwitch, on: boolean): Promise<void> {
  if (!MAIL_SWITCHES.includes(name)) return;
  await db.merchant.updateMany({ where: { id: merchantId, ownerId }, data: { [name]: on } });
}

/** A send that went through: whatever failed before works again. */
export async function clearMailFailure(merchantId: string): Promise<void> {
  await db.merchant.updateMany({ where: { id: merchantId, emailFailure: { not: null } }, data: { emailFailure: null, emailFailedAt: null } });
}

export type MailStatus = {
  host: string;
  port: number;
  user: string;
  from: string;
  notifyNewAffiliates: boolean;
  notifyNewSales: boolean;
  emailAffiliates: boolean;
  failure: { message: string; at: Date } | null;
} | null;

/** What the product's settings show: no password, ever. */
export async function mailStatus(ownerId: string, merchantId: string): Promise<MailStatus> {
  const row = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: {
      smtpHost: true,
      smtpPort: true,
      smtpUser: true,
      mailFrom: true,
      notifyNewAffiliates: true,
      notifyNewSales: true,
      emailAffiliates: true,
      emailFailure: true,
      emailFailedAt: true,
    },
  });
  if (!row?.smtpHost || !row.smtpPort || !row.mailFrom) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser ?? "",
    from: row.mailFrom,
    notifyNewAffiliates: row.notifyNewAffiliates,
    notifyNewSales: row.notifyNewSales,
    emailAffiliates: row.emailAffiliates,
    failure: row.emailFailure && row.emailFailedAt ? { message: row.emailFailure, at: row.emailFailedAt } : null,
  };
}
