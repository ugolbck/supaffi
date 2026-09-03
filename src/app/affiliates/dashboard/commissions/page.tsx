import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAffiliate } from "@/lib/affiliateAuth";
import {
  listAffiliateCommissions,
  getAffiliateCommissionTotals,
  type AffiliateCommissionRow,
  type AffiliateCommissionStatus,
} from "@/lib/affiliate";
import { PageShell, PageHeader, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard } from "@/components/dashboard/DashboardCard";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { STATUS_LABELS } from "../OverviewCards";
import { CommissionLedger, type LedgerRow } from "./CommissionLedger";

const PAGE_SIZE = 25;

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

const STATUSES: readonly AffiliateCommissionStatus[] = ["PENDING", "PAYABLE", "PAID", "VOIDED"];

function parseStatus(raw: string | undefined): AffiliateCommissionStatus | null {
  const upper = raw?.toUpperCase();
  return STATUSES.find((s) => s === upper) ?? null;
}

function sanitizePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000);
}

/**
 * What this commission is waiting on, or what happened to it. The point of
 * the screen: an Affiliate's first question is when the money arrives.
 *
 * VOIDED stays the bare word. The row carries no void reason, and a void can
 * be a refund or a confirmed self-referral, so the label must not claim a
 * refund happened (the same call the overview cards made, OverviewCards.tsx).
 */
function whenYouGetIt(row: AffiliateCommissionRow): string {
  if (row.status === "VOIDED") return "Voided";
  if (row.status === "PAID") return `Paid ${DATE.format(row.paidAt ?? row.payableAt)}`;
  if (row.status === "PAYABLE") return "Ready to pay";
  return `Clears ${DATE.format(row.payableAt)}`;
}

function Tile({
  label,
  count,
  href,
  active,
}: {
  label: string;
  count: number;
  href: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      className={`group flex cursor-pointer flex-col gap-1 rounded-(--radius-lg) border px-3.5 py-3 transition-[border-color,background-color] duration-200 ease-[var(--ease-out)] ${
        active
          ? "border-primary/60 bg-elevated [background-image:var(--elevated-surface)] shadow-[var(--edge-light),var(--shadow-xs)]"
          : "border-border/70 bg-card/50 hover:border-border hover:bg-card"
      }`}
    >
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      <span className="font-heading text-xl leading-none font-semibold tracking-tight tabular-nums">
        {count}
      </span>
    </Link>
  );
}

export default async function AffiliateCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const { affiliateId } = await requireAffiliate();
  const query = await searchParams;
  const status = parseStatus(query.status);
  const page = sanitizePage(query.page);

  const [{ rows, total }, totals] = await Promise.all([
    listAffiliateCommissions(affiliateId, { page, pageSize: PAGE_SIZE, status }),
    getAffiliateCommissionTotals(affiliateId),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Every href keeps the status filter that is already on and changes one
  // thing, so paging through a filtered view does not silently drop it.
  function hrefWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = { status, ...changes };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const search = params.toString();
    return search ? `?${search}` : "?";
  }

  // Same hole as the owner ledger: a page number past the end rendered an
  // empty ledger under a label counting rows that are not there.
  if (page > totalPages) {
    const search = hrefWith({ page: totalPages > 1 ? String(totalPages) : null });
    redirect(`/affiliates/dashboard/commissions${search === "?" ? "" : search}`);
  }

  const allCount = totals.reduce((sum, t) => sum + t.count, 0);

  const ledgerRows: LedgerRow[] = rows.map((row) => ({
    id: row.id,
    dateLabel: DATE.format(row.createdAt),
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    linkCode: row.linkCode,
    whenLabel: whenYouGetIt(row),
  }));

  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  return (
    <PageShell>
      <PageHeader title="Commissions" />

      <div className="grid shrink-0 grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-5">
        <Tile label="All" count={allCount} href={hrefWith({ status: null })} active={status === null} />
        {totals.map((t) => (
          <Tile
            key={t.status}
            label={STATUS_LABELS[t.status]}
            count={t.count}
            href={hrefWith({ status: t.status })}
            active={status === t.status}
          />
        ))}
      </div>

      <Band columns={12}>
        <DashboardCard
          title="Ledger"
          className="lg:col-span-12"
          bodyPadding={ledgerRows.length === 0}
          footer={
            <div className="flex flex-wrap items-center justify-between gap-3">
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
                        render={
                          <Link href={hrefWith({ page: String(Math.min(totalPages, page + 1)) })} />
                        }
                        aria-disabled={page >= totalPages}
                      />
                    </PaginationItem>
                  </PaginationContent>
                </Pagination>
              )}
            </div>
          }
        >
          <CommissionLedger rows={ledgerRows} filtered={status !== null} />
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
