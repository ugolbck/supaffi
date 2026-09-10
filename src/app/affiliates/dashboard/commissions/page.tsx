import Link from "next/link";
import { redirect } from "next/navigation";
import { requireAffiliate } from "@/lib/affiliateAuth";
import {
  listAffiliateCommissions,
  getAffiliateCommissionTotals,
  type AffiliateCommissionStatus,
} from "@/lib/affiliate";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { CommissionLedger, STATUS_LABELS, toLedgerRow, type LedgerRow } from "./CommissionLedger";

/**
 * Every commission, and why each one is the amount it is.
 *
 * The owner's commissions screen minus everything an affiliate cannot do: no
 * checkboxes, no bulk actions, no flag controls, no payment references. Same
 * tabs over one ledger, same card, so the two sides read as one product.
 */

const PAGE_SIZE = 25;

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
  const tabs: { label: string; count: number; status: AffiliateCommissionStatus | null }[] = [
    { label: "All", count: allCount, status: null },
    ...totals.map((t) => ({ label: STATUS_LABELS[t.status], count: t.count, status: t.status })),
  ];

  const ledgerRows: LedgerRow[] = rows.map(toLedgerRow);

  const statusTabs = (
    <Tabs value={status ?? "all"}>
      <TabsList variant="line">
        {tabs.map((tab) => (
          <TabsTrigger
            key={tab.label}
            value={tab.status ?? "all"}
            render={
              <Link href={hrefWith({ status: tab.status, page: null })} className="cursor-pointer" />
            }
          >
            {tab.label}
            <span className="ml-1.5 text-muted-foreground tabular-nums">{tab.count}</span>
          </TabsTrigger>
        ))}
      </TabsList>
    </Tabs>
  );

  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);

  return (
    <Page>
      <PageTitle title="Commissions" actions={<div className="hidden md:block">{statusTabs}</div>} />

      {/* The same tabs get their own row on a phone, where five of them plus a
          heading do not fit on one line and would push the page sideways. */}
      <div className="-mx-8 shrink-0 overflow-x-auto px-8 md:hidden">{statusTabs}</div>

      {/* Flush and clipped: the rows are the card, and the table scrolls
          inside it so the page never does. */}
      <Section flush scroll className="overflow-hidden">
        <CommissionLedger rows={ledgerRows} filtered={status !== null} />
      </Section>

      {total > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {`${firstShown}-${lastShown} of ${total}`}
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
      )}
    </Page>
  );
}
