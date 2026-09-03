import type { ReactNode } from "react";

/**
 * A table's scroll area, with the empty part of the card ruled like the rest
 * of the ledger.
 *
 * A table with three rows in a tall card leaves a blank slab under them. The
 * filler continues the row rhythm to the bottom of the body as empty ruled
 * lines, the way a paper ledger does, so the card reads as a ledger with room
 * left rather than as a gap (docs/design/wireframes.md, section 1).
 *
 * The technique is a flex column that is at least as tall as the scrollport
 * (`min-h-full`), holding the table first and a `flex-1` filler last. The
 * filler therefore begins exactly at the bottom of the last row without
 * anything measuring where that is:
 *
 * - rows shorter than the card: the column is pinned to the scrollport height
 *   and the filler takes the leftover as free space;
 * - rows taller than the card: the column grows past its minimum, there is no
 *   free space, and the filler collapses to nothing;
 * - below `lg` the scrollport has no definite height, so `min-h-full` resolves
 *   to nothing and the filler is zero. Correct, because there is no slab to
 *   fill when the page itself is what scrolls.
 *
 * That is true at any container height, which matters on a grid whose row
 * sizes come from the viewport.
 *
 * The lines are a repeating gradient pitched to `--row-pitch`, the height
 * every body row is pinned to, so the first filler line lands exactly one row
 * below the last real one. It is drawn from `--border`, so it follows the
 * theme, at reduced opacity so it stays quieter than a real row's rule. It is
 * `aria-hidden` and takes no pointer events: filler is never a row.
 */

/** Pin every body row to the pitch the filler is drawn at. */
export const LEDGER_ROW_HEIGHT = "h-(--row-pitch)";

const FILLER_RULES =
  "repeating-linear-gradient(to bottom, transparent 0, transparent calc(var(--row-pitch) - 1px), var(--border) calc(var(--row-pitch) - 1px), var(--border) var(--row-pitch))";

export function LedgerScroller({ children }: { children: ReactNode }) {
  return (
    <div className="flex-1 overflow-y-auto [--row-pitch:3.5rem] lg:min-h-0">
      <div className="flex min-h-full flex-col">
        {children}
        <div
          aria-hidden
          className="pointer-events-none flex-1 opacity-50"
          style={{ backgroundImage: FILLER_RULES }}
        />
      </div>
    </div>
  );
}
