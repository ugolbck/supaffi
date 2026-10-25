import Link from "next/link";
import { cn } from "@/lib/utils";
import {
  Pagination,
  PaginationContent,
  PaginationEllipsis,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { pageList } from "@/lib/pagination";

/**
 * The one pager under every ledger: the range shown on the left, numbered
 * pages on the right. Each page is a real link built by the caller, so the
 * page's own URL params (filters, tab) survive paging.
 */
export function TablePagination({
  page,
  pageSize,
  total,
  hrefFor,
}: {
  page: number;
  pageSize: number;
  total: number;
  /** The href for a page number, with the page's other params kept. */
  hrefFor: (page: number) => string;
}) {
  if (total === 0) return null;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstShown = (page - 1) * pageSize + 1;
  const lastShown = Math.min(page * pageSize, total);
  const atStart = page <= 1;
  const atEnd = page >= totalPages;

  return (
    <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground tabular-nums">
        {`${firstShown}-${lastShown} of ${total}`}
      </p>
      {totalPages > 1 && (
        <Pagination className="mx-0 w-auto justify-end">
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                render={<Link href={hrefFor(Math.max(1, page - 1))} />}
                aria-disabled={atStart}
                tabIndex={atStart ? -1 : undefined}
                className={cn(atStart && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
            {pageList(page, totalPages).map((p, i) =>
              p === "gap" ? (
                <PaginationItem key={`gap-${i}`}>
                  <PaginationEllipsis />
                </PaginationItem>
              ) : (
                <PaginationItem key={p}>
                  <PaginationLink render={<Link href={hrefFor(p)} />} isActive={p === page}>
                    {p}
                  </PaginationLink>
                </PaginationItem>
              )
            )}
            <PaginationItem>
              <PaginationNext
                render={<Link href={hrefFor(Math.min(totalPages, page + 1))} />}
                aria-disabled={atEnd}
                tabIndex={atEnd ? -1 : undefined}
                className={cn(atEnd && "pointer-events-none opacity-50")}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
