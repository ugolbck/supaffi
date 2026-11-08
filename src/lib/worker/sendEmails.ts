import { Prisma } from "@prisma/client";
import type { Email } from "@prisma/client";
import { db } from "@/lib/db";
import { clearMailFailure, mailErrorText, sendWith, smtpSettings, type SmtpSettings } from "@/lib/mail";

const BATCH_SIZE = 20;
// Retries double from a minute; the seventh failure is the last, about an
// hour in. An email is news: a day late it is worth less than the noise of
// retrying, and a server that refuses for an hour needs the Owner, who sees
// the failure on the Account page.
const MAX_ATTEMPTS = 7;
const BASE_BACKOFF_MS = 60_000;
const CLAIM_LEASE_SECONDS = 5 * 60;

// The same SKIP LOCKED claim as the webhook queue (claim.ts), lease included,
// so a worker that dies mid-send leaves the row to be claimed again. Like
// claim.ts, a row whose lease ran out on its last attempt is failed first,
// or it would be reclaimed forever.
export async function claimEmails(): Promise<Email[]> {
  await db.$executeRaw`
    UPDATE "Email"
    SET status = 'FAILED', text = '', html = '',
        "lastError" = COALESCE("lastError", 'The worker stopped while sending this email.')
    WHERE status = 'SENDING'
      AND "nextAttemptAt" <= now()
      AND attempts >= ${MAX_ATTEMPTS};
  `;

  return db.$queryRaw<Email[]>(Prisma.sql`
    WITH claimed AS (
      SELECT id
      FROM "Email"
      WHERE status IN ('PENDING', 'SENDING')
        AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE "Email" e
    SET status = 'SENDING',
        attempts = e.attempts + 1,
        "nextAttemptAt" = now() + ${CLAIM_LEASE_SECONDS} * interval '1 second'
    FROM claimed
    WHERE e.id = claimed.id
    RETURNING e.*;
  `);
}

// Once an email is sent or given up on, its body goes: a password email holds
// a live link, and the database is no place to keep one.
const DONE = { text: "", html: "" };

async function retryLater(email: Email, message: string): Promise<void> {
  const terminal = email.attempts >= MAX_ATTEMPTS;
  await db.email.update({
    where: { id: email.id },
    data: terminal
      ? { status: "FAILED", lastError: message, ...DONE }
      : { status: "PENDING", lastError: message, nextAttemptAt: new Date(Date.now() + BASE_BACKOFF_MS * 2 ** (email.attempts - 1)) },
  });
  if (terminal) {
    await db.owner.update({ where: { id: email.ownerId }, data: { emailFailure: message, emailFailedAt: new Date() } });
  }
}

export async function sendDueEmails(send: typeof sendWith = sendWith): Promise<void> {
  const batch = await claimEmails();
  // Read once per Owner per batch: most batches are one Owner.
  const servers = new Map<string, SmtpSettings | null | "unreadable">();
  // An Owner whose server could not be reached: the rest of their batch waits
  // for the next try instead of each one waiting out the same timeout.
  const unreachable = new Map<string, string>();

  for (const email of batch) {
    if (!servers.has(email.ownerId)) {
      try {
        servers.set(email.ownerId, await smtpSettings(email.ownerId));
      } catch (err) {
        console.error(`[worker] could not read the mail settings of owner ${email.ownerId}`, err);
        servers.set(email.ownerId, "unreadable");
      }
    }
    const server = servers.get(email.ownerId);
    if (server === "unreadable") {
      await retryLater(email, "The saved mail settings could not be read. Connect again.");
      continue;
    }
    if (!server) {
      // Turned off after this was queued: dropped, as turning off says.
      await db.email.update({ where: { id: email.id }, data: { status: "FAILED", lastError: "Email is off", ...DONE } });
      continue;
    }
    const skipped = unreachable.get(email.ownerId);
    if (skipped) {
      await retryLater(email, skipped);
      continue;
    }
    try {
      await send(server, email);
      await db.email.update({ where: { id: email.id }, data: { status: "SENT", sentAt: new Date(), lastError: null, ...DONE } });
      await clearMailFailure(email.ownerId);
    } catch (err) {
      const message = mailErrorText(err, server);
      const code = (err as { code?: string }).code ?? "";
      console.error(`[worker] email ${email.id} failed: ${message}`, code);
      if (["ECONNECTION", "ETIMEDOUT", "ESOCKET", "EDNS", "EAUTH"].includes(code)) unreachable.set(email.ownerId, message);
      await retryLater(email, message);
    }
  }
}

let sending = false;

/** One pass of the queue at a time. Never throws. */
export async function runEmailSender(): Promise<void> {
  if (sending) return;
  sending = true;
  try {
    await sendDueEmails();
  } catch (err) {
    console.error("[worker] sending email failed", err);
  } finally {
    sending = false;
  }
}
