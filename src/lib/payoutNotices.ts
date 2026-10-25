import { STALE_PAGE } from "@/lib/commission";
import { formatCount, formatDate } from "@/lib/format";

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

// Said when Mark paid reached rows an earlier press had already recorded, for
// example from a tab opened before that payout. `on` is when the latest of
// them was marked, in milliseconds; `recorded` is set when the same press
// still recorded other rows.
export function alreadyPaidNote(
  raw: string | undefined,
  on: string | undefined,
  recorded: string | undefined
): string | null {
  const already = Math.floor(Number(raw));
  if (!Number.isFinite(already) || already < 1) return null;
  const at = on ? new Date(Number(on)) : null;
  const when = at && !Number.isNaN(at.getTime()) ? ` on ${formatDate(at)}` : "";
  if (!recorded) return `Already marked paid${when}. Nothing recorded.`;
  return `${formatCount(already)} already marked paid${when}, not recorded again.`;
}

// The query parameters `alreadyPaidNote` reads, from what the ledger returned.
export function alreadyPaidParams(result: {
  count: number;
  alreadyPaid?: { count: number; paidAt: Date | null };
}): Record<string, string> {
  const { alreadyPaid } = result;
  if (!alreadyPaid) return {};
  return {
    already: String(alreadyPaid.count),
    ...(alreadyPaid.paidAt && { paidOn: String(alreadyPaid.paidAt.getTime()) }),
    ...(result.count > 0 && { recorded: "1" }),
  };
}
