import nodemailer from "nodemailer";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { decrypt, encrypt } from "@/lib/crypto";

/**
 * The Owner's own mail server, reached over SMTP. One transport covers every
 * provider an Owner is likely to use (Resend, Brevo, Amazon SES, Postmark,
 * Gmail Workspace all take SMTP), so there is no second way of sending to keep
 * working. Supaffi never sends from the host itself: a VPS sending direct is
 * blocked or lands in spam.
 *
 * Email is off until an Owner saves settings that pass a test send, and
 * nothing is queued while it is off.
 */

export type SmtpSettings = { host: string; port: number; user: string; password: string; from: string };

/** What queueing needs to know. No password: that is read only to send. */
export type OwnerMail = {
  ownerEmail: string;
  notifyNewAffiliates: boolean;
  notifyNewSales: boolean;
  emailAffiliates: boolean;
};

const MAIL_SELECT = {
  email: true,
  smtpHost: true,
  smtpPort: true,
  smtpUser: true,
  smtpPasswordEnc: true,
  mailFrom: true,
  notifyNewAffiliates: true,
  notifyNewSales: true,
  emailAffiliates: true,
} as const;

type MailRow = Prisma.OwnerGetPayload<{ select: typeof MAIL_SELECT }>;

function toOwnerMail(row: MailRow | null): OwnerMail | null {
  if (!row?.smtpHost || !row.smtpPort || !row.mailFrom) return null;
  return {
    ownerEmail: row.email,
    notifyNewAffiliates: row.notifyNewAffiliates,
    notifyNewSales: row.notifyNewSales,
    emailAffiliates: row.emailAffiliates,
  };
}

type OwnerReader = { owner: { findUnique: typeof db.owner.findUnique } };

/** The Owner's mail settings, or null while email is off. */
export async function ownerMail(ownerId: string, client: OwnerReader = db): Promise<OwnerMail | null> {
  const row = await client.owner.findUnique({ where: { id: ownerId }, select: MAIL_SELECT });
  return toOwnerMail(row);
}

/** The server to send through, password decrypted, or null while email is off. */
export async function smtpSettings(ownerId: string): Promise<SmtpSettings | null> {
  const row = await db.owner.findUnique({ where: { id: ownerId }, select: MAIL_SELECT });
  if (!row?.smtpHost || !row.smtpPort || !row.mailFrom) return null;
  return {
    host: row.smtpHost,
    port: row.smtpPort,
    user: row.smtpUser ?? "",
    password: row.smtpPasswordEnc ? decrypt(row.smtpPasswordEnc) : "",
    from: row.mailFrom,
  };
}

/** Whether a product's Owner can email its affiliates, for the screens that offer it. */
export async function merchantCanEmailAffiliates(merchantId: string): Promise<boolean> {
  const merchant = await db.merchant.findUnique({ where: { id: merchantId }, select: { owner: { select: MAIL_SELECT } } });
  return toOwnerMail(merchant?.owner ?? null) !== null;
}

// Short enough that a test send on the Account page answers while the Owner
// is still looking at it, long enough for a slow provider's greeting.
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

/**
 * Checks the settings by sending a test email to the Owner, and saves them
 * only when it arrives at the server. Settings that cannot send are never
 * saved, so email is either working or off. A blank password keeps the
 * stored one, so editing the server does not mean typing it again.
 */
export async function connectMail(
  ownerId: string,
  input: MailSettingsInput,
  test: (settings: SmtpSettings, to: string) => Promise<void>
): Promise<{ error: string } | { sentTo: string }> {
  const host = input.host.trim().toLowerCase();
  const port = Number(input.port.trim() || "587");
  const user = input.user.trim();
  const from = input.from.trim().toLowerCase();
  if (!HOST.test(host)) return { error: "Enter the server's address, like smtp.resend.com" };
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "Enter a port between 1 and 65535" };
  if (!isSingleAddress(from)) return { error: "Enter the address emails come from" };

  const owner = await db.owner.findUnique({
    where: { id: ownerId },
    select: { email: true, smtpHost: true, smtpUser: true, smtpPasswordEnc: true },
  });
  if (!owner) return { error: "Account not found" };
  // The stored password is only kept for the server and account it belongs
  // to, never handed to a different one.
  const sameAccount = owner.smtpHost === host && (owner.smtpUser ?? "") === user;
  if (!input.password && user && !(sameAccount && owner.smtpPasswordEnc)) return { error: "Enter the password" };
  const password = input.password || (sameAccount && owner.smtpPasswordEnc ? decrypt(owner.smtpPasswordEnc) : "");
  const settings = { host, port, user, password, from };

  try {
    await test(settings, owner.email);
  } catch (err) {
    return { error: mailErrorText(err, settings) };
  }

  await db.owner.update({
    where: { id: ownerId },
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
  return { sentTo: owner.email };
}

/** Turns email off. Anything still queued is dropped by the worker unsent. */
export async function disconnectMail(ownerId: string): Promise<void> {
  await db.owner.update({
    where: { id: ownerId },
    data: { smtpHost: null, smtpPort: null, smtpUser: null, smtpPasswordEnc: null, mailFrom: null, emailFailure: null, emailFailedAt: null },
  });
}

export const MAIL_SWITCHES = ["notifyNewAffiliates", "notifyNewSales", "emailAffiliates"] as const;
export type MailSwitch = (typeof MAIL_SWITCHES)[number];

export async function setMailSwitch(ownerId: string, name: MailSwitch, on: boolean): Promise<void> {
  if (!MAIL_SWITCHES.includes(name)) return;
  await db.owner.update({ where: { id: ownerId }, data: { [name]: on } });
}

/** A send that went through: whatever failed before works again. */
export async function clearMailFailure(ownerId: string): Promise<void> {
  await db.owner.updateMany({ where: { id: ownerId, emailFailure: { not: null } }, data: { emailFailure: null, emailFailedAt: null } });
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

/** What the Account page shows: no password, ever. */
export async function mailStatus(ownerId: string): Promise<MailStatus> {
  const row = await db.owner.findUnique({
    where: { id: ownerId },
    select: { ...MAIL_SELECT, smtpPasswordEnc: false, emailFailure: true, emailFailedAt: true },
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
