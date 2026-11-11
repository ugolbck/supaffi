/**
 * How the worker's best-effort Stripe reads tell an outage from a key that
 * cannot read something.
 *
 * A key without a permission fails the same way on every retry, so those reads
 * fall back and carry on. An outage, a rate limit or a dropped connection
 * passes, so those throw and the event is retried, rather than a commission
 * being written as if no refund, dispute or matching card existed.
 */

type StripeLikeError = { type?: string; code?: string; statusCode?: number };

const TRANSIENT_TYPES = ["StripeConnectionError", "StripeAPIError", "StripeRateLimitError"];

export function isTransientStripeError(err: unknown): boolean {
  const { type, statusCode } = (err ?? {}) as StripeLikeError;
  if (type && TRANSIENT_TYPES.includes(type)) return true;
  return statusCode === 429 || (typeof statusCode === "number" && statusCode >= 500);
}

/**
 * The error's type and code, for a log line. Never Stripe's own message: on a
 * permission or authentication failure that names the masked key and the
 * account.
 */
export function stripeErrorLabel(err: unknown): string {
  const { type, code } = (err ?? {}) as StripeLikeError;
  return `${type ?? "unknown"}/${code ?? "unknown"}`;
}

/**
 * Text for any error the worker logs or stores. A Stripe error becomes its
 * type and code; anything else keeps its own message.
 */
export function isStripeError(err: unknown): boolean {
  const { type } = (err ?? {}) as StripeLikeError;
  return typeof type === "string" && type.startsWith("Stripe");
}

export function loggableError(err: unknown): string {
  if (isStripeError(err)) return `Stripe error ${stripeErrorLabel(err)}`;
  return err instanceof Error ? err.message : String(err);
}
