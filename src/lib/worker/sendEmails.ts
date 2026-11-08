import { Prisma } from "@prisma/client";
import type { Email } from "@prisma/client";
import { db } from "@/lib/db";
import { mailErrorText, sendWith, smtpSettings, type SmtpSettings } from "@/lib/mail";

const BATCH_SIZE = 20;
// Retries double from a minute and stop after the sixth, about an hour in. An
// email is news: a day late it is worth less than the noise of retrying, and
// a server that refuses for an hour needs the Owner, who sees the failure on
// the Account page.
const MAX_ATTEMPTS = 6;
const BASE_BACKOFF_MS = 60_000;
const CLAIM_LEASE_SECONDS = 5 * 60;

// The same SKIP LOCKED claim as the webhook queue (claim.ts), lease included,
// so a worker that dies mid-send leaves the row to be claimed again.
export async function claimEmails(): Promise<Email[]> {
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

export async function sendDueEmails(send: typeof sendWith = sendWith): Promise<void> {
  const batch = await claimEmails();
  // One read of the settings per Owner per batch: most batches are one Owner.
  const settings = new Map<string, SmtpSettings | null>();
  for (const email of batch) {
    if (!settings.has(email.ownerId)) settings.set(email.ownerId, await smtpSettings(email.ownerId));
    const server = settings.get(email.ownerId);
    if (!server) {
      // Turned off after this was queued: dropped, as turning off says.
      await db.email.update({ where: { id: email.id }, data: { status: "FAILED", lastError: "Email is off" } });
      continue;
    }
    try {
      await send(server, email);
      await db.$transaction([
        db.email.update({ where: { id: email.id }, data: { status: "SENT", sentAt: new Date(), lastError: null } }),
        // One that gets through means the server works again.
        db.owner.updateMany({ where: { id: email.ownerId, emailFailure: { not: null } }, data: { emailFailure: null, emailFailedAt: null } }),
      ]);
    } catch (err) {
      const message = mailErrorText(err, server);
      console.error(`[worker] email ${email.id} failed: ${message}`, (err as { code?: string }).code ?? "");
      const terminal = email.attempts >= MAX_ATTEMPTS;
      await db.email.update({
        where: { id: email.id },
        data: {
          status: terminal ? "FAILED" : "PENDING",
          lastError: message,
          nextAttemptAt: new Date(Date.now() + (terminal ? 0 : BASE_BACKOFF_MS * 2 ** (email.attempts - 1))),
        },
      });
      if (terminal) {
        await db.owner.update({ where: { id: email.ownerId }, data: { emailFailure: message, emailFailedAt: new Date() } });
      }
    }
  }
}
