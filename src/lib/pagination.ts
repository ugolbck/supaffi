/**
 * The page numbers a pager shows: the first, the last, and the pages either
 * side of the current one, with a gap wherever numbers are skipped. Every page
 * number at once ran off the screen once a ledger reached a few hundred rows.
 *
 * Seven or fewer pages are all shown, since a gap would hide no more than one.
 */
export function pageList(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  // Near either end the window is widened, so the pager keeps the same number
  // of slots and does not jump in width as you page through it.
  const start = Math.max(2, Math.min(page - 1, totalPages - 4));
  const end = Math.min(totalPages - 1, Math.max(page + 1, 5));

  const list: (number | "gap")[] = [1];
  if (start > 2) list.push("gap");
  for (let p = start; p <= end; p += 1) list.push(p);
  if (end < totalPages - 1) list.push("gap");
  list.push(totalPages);
  return list;
}
