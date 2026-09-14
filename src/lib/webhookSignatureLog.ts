/**
 * Decides whether a rejected webhook signature is written to the server log.
 *
 * The webhook address is public and Stripe retries every delivery it could
 * not make, so a bad signature can arrive many times a minute. The first one
 * for a product is always logged, then at most one line every 15 minutes.
 * Held in memory: after a restart the next rejection is logged again, which
 * costs at most one extra line.
 */
const LOG_EVERY_MS = 15 * 60_000;

const lastLoggedAt = new Map<string, number>();

export function shouldLogSignatureFailure(merchantId: string, now: number = Date.now()): boolean {
  const last = lastLoggedAt.get(merchantId);
  if (last !== undefined && now - last < LOG_EVERY_MS) return false;
  lastLoggedAt.set(merchantId, now);
  return true;
}
