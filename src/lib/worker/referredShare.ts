
/**
 * The referred share as the ledger can store it.
 *
 * Commission.referredChargeMinor is a BIGINT column (migration
 * 20260914180000_commission_referred_charge_minor_bigint). Stripe's own
 * documented ceiling sits comfortably inside it: "the amount value supports
 * up to: 12 digits for most card payments, for a maximum of 999,999,999,999
 * in the smallest currency unit" and, for methods other than cards, "12
 * digits for IDR, for a payment of up to 9,999,999,999.99 IDR (999999999999)"
 * (Stripe docs, currencies.md, "Maximum payment amounts"; German original:
 * "12 Ziffern für die meisten Kartenzahlungen, für ein Maximum von
 * 999.999.999.999 in der kleinsten Währungseinheit" and "12 Ziffern für IDR,
 * für eine Zahlung in Höhe von maximal 9.999.999.999,99 IDR
 * (`999999999999`)"). 999,999,999,999 is past INTEGER's range, which is why
 * this column had to widen to BIGINT, and still far below
 * Number.MAX_SAFE_INTEGER (9,007,199,254,740,991), which is why converting it
 * to and from a plain number is always exact. A share outside that safe
 * range cannot come from a real Stripe amount, so it can only be a bug; a
 * retry would see the same bug again, but throwing still stops this event
 * from silently truncating the figure or quietly earning nothing, and gets
 * the failure into the logs where a bug can be found.
 */
export function storableReferredShare(shareMinor: number): bigint {
  if (!Number.isSafeInteger(shareMinor)) {
    throw new Error(
      `a referred share of ${shareMinor} is outside the range Supaffi can safely record, so this event is retried`
    );
  }
  return BigInt(shareMinor);
}

/**
 * A stored referred share read back as a plain number, for the maths in
 * reversal.ts, which predates BigInt and works in ordinary numbers
 * throughout. Every value this module ever wrote came through
 * storableReferredShare above, so it is always inside the safe range; this
 * only guards against something else having written the column directly.
 */
export function readStoredReferredShare(value: bigint | null): number | null {
  if (value === null) return null;
  if (value < BigInt(Number.MIN_SAFE_INTEGER) || value > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error(`stored referred share ${value} is outside the range Supaffi can safely read, so this event is retried`);
  }
  return Number(value);
}
