import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Radio } from "lucide-react";
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
import { getPayableGroups, getProductMetrics, toWeeks } from "@/lib/analytics";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { PageShell, PageHeader, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { BarChart } from "@/components/charts/BarChart";
import { StatusTiles } from "./StatusTiles";
import { CommissionFilters } from "./CommissionFilters";
import { CommissionTable, type LedgerRow } from "./CommissionTable";
import { PayableRail } from "./PayableRail";

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

const VOLUME_WEEKS = 12;
const VOLUME_WINDOW_DAYS = VOLUME_WEEKS * 7;

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

  const [{ rows, total }, totals, options, payableGroups, volume] = await Promise.all([
    listCommissions(session.user.id, merchant.id, filters, {
      page,
      pageSize: COMMISSIONS_PAGE_SIZE,
    }),
    getCommissionTotals(session.user.id, merchant.id),
    getCommissionFilterOptions(session.user.id, merchant.id),
    getPayableGroups(session.user.id, merchant.id),
    getProductMetrics(session.user.id, merchant.id, VOLUME_WINDOW_DAYS),
  ]);

  const weeklyVolume = toWeeks(volume.series);

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

  // Built here, not passed as a function: a function prop can't cross the
  // server/client boundary to PayableRail, and building the href server-side
  // keeps the one navigation rule (clicking an affiliate row filters the
  // ledger, preserving whatever else is on) in the same place hrefWith
  // already lives for every other control on this page.
  const railGroups = payableGroups.map((group) => ({
    ...group,
    href: hrefWith({ affiliate: group.affiliateId }),
  }));

  return (
    <PageShell>
      <PageHeader
        title="Commissions"
        subtitle={`${merchant.name} · every referred sale and what it is waiting on`}
      />

      <StatusTiles
        totals={totals}
        activeStatus={filters.status}
        hrefFor={(status) => hrefWith({ status })}
      />

      <Band columns={12}>
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] lg:col-span-9">
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

        {/* Grid, not flex: the top card's `h-full` needs a row with a
            resolved size to stretch into. A flex column with one flex-1 child
            and one fixed child fights that same class, since `h-full` sets
            height:100% while `flex-1` sets flex-basis, and Tailwind's
            generated stylesheet order (not JSX order) decides which wins. A
            1fr/auto row template gives each card a size before `h-full` is
            ever evaluated, so there is nothing to race. */}
        <div className="grid grid-rows-[1fr_auto] gap-4 lg:col-span-3 lg:h-full lg:min-h-0">
          <PayableRail merchantId={merchant.id} groups={railGroups} />

          <DashboardCard title={`Volume, ${VOLUME_WEEKS} weeks`}>
            {volume.clicks === 0 ? (
              <CardEmpty icon={Radio} title="No activity in the last 12 weeks" />
            ) : (
              <BarChart series={weeklyVolume} />
            )}
          </DashboardCard>
        </div>
      </Band>
    </PageShell>
  );
}
