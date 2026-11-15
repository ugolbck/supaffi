import { createHmac, timingSafeEqual } from "node:crypto";

// Standard Webhooks' tolerance, which Polar's signer uses: a delivery older or
// newer than this is refused, so a captured one cannot be replayed later.
const TOLERANCE_SECONDS = 5 * 60;

/**
 * Checks a Polar delivery the way Polar signs it (Standard Webhooks:
 * HMAC-SHA256 over `<webhook-id>.<webhook-timestamp>.<body>`, sent as
 * `v1,<base64>` in webhook-signature).
 *
 * Polar has two kinds of secret, both starting `whsec_`. One generated from
 * 2026-09-08 is keyed on the base64 after the prefix; an older one on the
 * whole string's bytes (polar.sh/docs/integrate/webhooks/delivery). Both are
 * tried, as Polar's own SDK does.
 */
export function verifyPolarSignature(rawBody: string, headers: Headers, secret: string, now: number = Date.now()): boolean {
  const id = headers.get("webhook-id");
  const timestamp = headers.get("webhook-timestamp");
  const signatures = headers.get("webhook-signature");
  if (!id || !timestamp || !signatures) return false;

  const seconds = Number(timestamp);
  if (!Number.isInteger(seconds) || Math.abs(now / 1000 - seconds) > TOLERANCE_SECONDS) return false;

  const content = Buffer.from(`${id}.${timestamp}.${rawBody}`, "utf8");
  const keys = [Buffer.from(secret.replace(/^whsec_/, ""), "base64"), Buffer.from(secret, "utf8")];
  const sent = signatures
    .split(" ")
    .filter((part) => part.startsWith("v1,"))
    .map((part) => Buffer.from(part.slice(3), "base64"));

  return keys.some((key) => {
    if (key.length === 0) return false;
    const expected = createHmac("sha256", key).update(content).digest();
    return sent.some((signature) => signature.length === expected.length && timingSafeEqual(signature, expected));
  });
}
