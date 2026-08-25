import { Prisma } from "@prisma/client";
import type { WebhookEvent } from "@prisma/client";
import { db } from "@/lib/db";

const BATCH_SIZE = 10;
const MAX_ATTEMPTS = 5;
const BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 30 * 60_000; // 30min

// Standard Postgres SKIP LOCKED claim idiom: one atomic statement, no
// explicit transaction needed. Rows already claimed by another tick (or
// another Instance process, if one ever ran more than one) are skipped
// rather than waited on.
export async function claimBatch(): Promise<WebhookEvent[]> {
  return db.$queryRaw<WebhookEvent[]>(Prisma.sql`
    WITH claimed AS (
      SELECT id
      FROM "WebhookEvent"
      WHERE status = 'PENDING'
        AND "nextAttemptAt" <= now()
      ORDER BY "createdAt" ASC
      FOR UPDATE SKIP LOCKED
      LIMIT ${BATCH_SIZE}
    )
    UPDATE "WebhookEvent" w
    SET status = 'PROCESSING', attempts = w.attempts + 1
    FROM claimed
    WHERE w.id = claimed.id
    RETURNING w.*;
  `);
}

function backoffMs(attempts: number): number {
  return Math.min(BASE_BACKOFF_MS * 2 ** (attempts - 1), MAX_BACKOFF_MS);
}

export async function markProcessed(id: string): Promise<void> {
  await db.webhookEvent.update({
    where: { id },
    data: { status: "PROCESSED", processedAt: new Date() },
  });
}

// Retries land at ~30s, 60s, 120s, 240s after each failure — enough to ride
// out a transient Stripe/DB blip. After the 5th failure (~8 minutes of
// wall-clock retrying) the event is marked FAILED and stops being picked
// up: a genuinely broken event (a real handler bug, a malformed payload)
// shouldn't retry forever burning worker capacity and Stripe API quota,
// it needs a human to look at lastError.
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
