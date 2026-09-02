import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import {
  listCommissions,
  getCommissionTotals,
  getCommissionFilterOptions,
  COMMISSION_STATUSES,
  COMMISSIONS_PAGE_SIZE,
  type CommissionRow,
  type CommissionStatus,
} from "@/lib/commission";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { StatusTiles } from "./StatusTiles";
import { CommissionFilters } from "./CommissionFilters";
import { CommissionTable, type LedgerRow } from "./CommissionTable";

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

function parseStatus(raw: string | undefined): CommissionStatus | null {
  const upper = raw?.toUpperCase();
  return COMMISSION_STATUSES.find((s) => s === upper) ?? null;
}

// What this commission is waiting on, or what happened to it. One column for
// all five states, so a flagged row explains itself in the same place a paid
// one does rather than needing a screen of its own.
function stateLabel(row: CommissionRow): string {
  switch (row.status) {
    case "PENDING":
      return `Payable ${DATE.format(row.payableAt)}`;
    case "PAYABLE":
      return row.isAdjustment ? "Refund adjustment, carries forward" : "Ready to pay";
    case "FLAGGED":
      return row.flagReason ?? "Flagged for review";
    case "PAID":
      return row.paidAt ? `Paid ${DATE.format(row.paidAt)}` : "Paid";
    case "VOIDED":
      return row.voidReason ?? "Voided";
  }
}

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{
    status?: string;
    affiliate?: string;
    currency?: string;
    q?: string;
    page?: string;
  }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const filters = {
    status: parseStatus(query.status),
    affiliateId: query.affiliate ?? null,
    currency: query.currency ?? null,
    query: query.q ?? null,
  };
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);

  const [{ rows, total }, totals, options] = await Promise.all([
    listCommissions(session.user.id, merchant.id, filters, {
      page,
      pageSize: COMMISSIONS_PAGE_SIZE,
    }),
    getCommissionTotals(session.user.id, merchant.id),
    getCommissionFilterOptions(session.user.id, merchant.id),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / COMMISSIONS_PAGE_SIZE));
  const anyFilterActive = Boolean(
    filters.status || filters.affiliateId || filters.currency || filters.query
  );

  // Every href keeps the filters that are already on and changes one thing,
  // so switching status does not silently drop the affiliate you picked.
  function hrefWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      status: filters.status,
      affiliate: filters.affiliateId,
      currency: filters.currency,
      q: filters.query,
      ...changes,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const search = params.toString();
    return search ? `?${search}` : "?";
  }

  const ledgerRows: LedgerRow[] = rows.map((row) => ({
    id: row.id,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    affiliateId: row.affiliateId,
    affiliateName: row.affiliateName,
    affiliateEmail: row.affiliateEmail,
    stripePaymentRef: row.stripePaymentRef,
    isAdjustment: row.isAdjustment,
    createdLabel: DATE.format(row.createdAt),
    stateLabel: stateLabel(row),
  }));

  const firstShown = total === 0 ? 0 : (page - 1) * COMMISSIONS_PAGE_SIZE + 1;
  const lastShown = Math.min(page * COMMISSIONS_PAGE_SIZE, total);

  return (
    <div className="flex w-full flex-col gap-4 lg:h-full lg:min-h-0">
      <header className="flex shrink-0 flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h1 className="font-heading text-xl font-extrabold tracking-tight">Commissions</h1>
        <p className="text-sm text-muted-foreground">
          {merchant.name} · every referred sale and what it is waiting on
        </p>
      </header>

      <StatusTiles
        totals={totals}
        activeStatus={filters.status}
        hrefFor={(status) => hrefWith({ status })}
      />

      <section className="flex flex-col overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] lg:min-h-0 lg:flex-1">
        <div className="shrink-0 border-b border-border/60 px-4 py-3">
          <CommissionFilters
            affiliates={options.affiliates}
            currencies={options.currencies}
            affiliateId={filters.affiliateId}
            currency={filters.currency}
            query={filters.query ?? ""}
            anyFilterActive={anyFilterActive}
          />
        </div>

        <CommissionTable merchantId={merchant.id} rows={ledgerRows} filtered={anyFilterActive} />

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
          <p className="text-xs text-muted-foreground tabular-nums">
            {total === 0 ? "No results" : `${firstShown}-${lastShown} of ${total}`}
          </p>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    render={<Link href={hrefWith({ page: String(Math.max(1, page - 1)) })} />}
                    aria-disabled={page <= 1}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      render={<Link href={hrefWith({ page: String(p) })} />}
                      isActive={p === page}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    render={<Link href={hrefWith({ page: String(Math.min(totalPages, page + 1)) })} />}
                    aria-disabled={page >= totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      </section>
    </div>
  );
}
