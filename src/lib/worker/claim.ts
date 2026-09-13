import { Prisma } from "@prisma/client";
import type { WebhookEvent } from "@prisma/client";
import { db } from "@/lib/db";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 20;
const BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 4 * 60 * 60_000; // 4h

// How long a claimed row belongs to the tick that claimed it. A batch is
// processed one event at a time and each event can make several Stripe calls,
// so this is generous on purpose: a lease that ran out mid-batch would hand a
// live event to a second tick. Reprocessing is safe either way, every handler
// dedupes on a unique key, it just costs Stripe calls for nothing.
const CLAIM_LEASE_SECONDS = 10 * 60;

// Standard Postgres SKIP LOCKED claim idiom: one atomic statement, no
// explicit transaction needed. Rows already claimed by another tick (or
// another Instance process, if one ever ran more than one) are skipped
// rather than waited on.
//
// Claiming pushes nextAttemptAt out by the lease, which is what makes a crash
// recoverable. A process that dies or restarts mid-batch leaves its rows
// PROCESSING, and before this nothing ever looked at a PROCESSING row again,
// so those events were lost for good. Now a PROCESSING row whose lease has
// run out is claimed like a due PENDING one. Reprocessing it is safe: the
// commission handlers dedupe on Commission.stripePaymentRef, a refund
// recomputes from Stripe's cumulative figures, and the rest only set state.
export async function claimBatch(): Promise<WebhookEvent[]> {
  // A row that took the worker down on its last allowed attempt would
  // otherwise be reclaimed, crash it again, and never reach FAILED, since
  // only a handled error goes through markFailed.
  await db.$executeRaw`
    UPDATE "WebhookEvent"
    SET status = 'FAILED',
        "lastError" = COALESCE("lastError", 'The worker stopped while processing this event.')
    WHERE status = 'PROCESSING'
      AND "nextAttemptAt" <= now()
      AND attempts >= ${MAX_ATTEMPTS};
  `;

  return db.$queryRaw<WebhookEvent[]>(Prisma.sql`
    WITH claimed AS (
      SELECT id
      FROM "WebhookEvent"
      WHERE status IN ('PENDING', 'PROCESSING')
        AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE "WebhookEvent" w
    SET status = 'PROCESSING',
        attempts = w.attempts + 1,
        "nextAttemptAt" = now() + ${CLAIM_LEASE_SECONDS} * interval '1 second'
    FROM claimed
    WHERE w.id = claimed.id
    RETURNING w.*;
  `);
}

export function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export async function markProcessed(id: string): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

// Retries double from 30s up to a 4 hour ceiling, and the 20th failure is the
// last, which spreads the retrying over roughly two days. The old schedule
// gave up after about eight minutes, so a short Stripe outage or a rotated
// key that took an hour to fix silently lost every sale and refund in that
// window. Two days covers a weekend's worth of nobody looking, and still
// stops a genuinely broken event (a real handler bug, a malformed payload)
// from retrying forever: that one needs a human to look at lastError.
export async function markFailed(id: string, attempts: number, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const terminal = attempts >= MAX_ATTEMPTS;
  await db.webhookEvent.update({
    where: { id },
    data: {
      status: terminal ? "FAILED" : "PENDING",
      lastError: message.slice(0, 2000),
      nextAttemptAt: terminal ? new Date() : new Date(Date.now() + backoffMs(attempts)),
    },
  });
}
