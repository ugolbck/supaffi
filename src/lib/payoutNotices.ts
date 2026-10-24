import { STALE_PAGE } from "@/lib/commission";
import { formatCount } from "@/lib/format";

/**
 * The refusals the ledger can hand back after Mark paid, as sentences. The
 * action puts a code in the URL rather than its own text, so the only thing a
 * form can do is pick one of these; a code that is not here is ignored rather
 * than shown.
 */
const REFUSALS: Record<string, string> = {
  empty: "Nothing was selected, so there was nothing to pay.",
  mixed: "A payout covers one affiliate and one currency at a time.",
  stale: STALE_PAGE,
  refused: "The ledger refused that payout.",
};

export function refusalText(code: string | undefined): string | null {
  return code ? (REFUSALS[code] ?? null) : null;
}

// Said after a payout that left some shown rows unpaid, for example one the
// Owner voided in another tab between loading and clicking.
export function skippedNote(raw: string | undefined): string | null {
  const skipped = Math.floor(Number(raw));
  if (!Number.isFinite(skipped) || skipped < 1) return null;
  return skipped === 1
    ? "1 commission was not marked paid because it is no longer payable."
    : `${formatCount(skipped)} commissions were not marked paid because they are no longer payable.`;
}
