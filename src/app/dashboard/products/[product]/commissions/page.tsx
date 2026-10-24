import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import {
  listCommissions,
  getCommissionFilterOptions,
  COMMISSION_STATUSES,
  COMMISSIONS_PAGE_SIZE,
  type CommissionRow,
  type CommissionStatus,
} from "@/lib/commission";
import { getOwedTotals, type CurrencyTotal } from "@/lib/analytics";
import { refusalText, skippedNote } from "@/lib/payoutNotices";
import { formatMoney, money, moneyHint, formatDate } from "@/lib/format";
import { voidReasonText, flagReasonText } from "@/lib/commissionReason";
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
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { CommissionFilters } from "./CommissionFilters";
import { CommissionTable, type LedgerRow } from "./CommissionTable";
import { CommissionSheet, type SheetCommission } from "./CommissionSheet";

/**
 * Every referred sale and what it is waiting on.
 *
 * Four tabs over one ledger, and one commission read in a sheet the URL
 * selects, so the panel is rendered here rather than held on the client: a
 * payout or a void lands back on this page and the sheet is simply drawn again
 * from the new rows. Flagged is a tab, never a page of its own.
 */


const TABS: { label: string; status: CommissionStatus | null }[] = [
  { label: "All", status: null },
  { label: "Payable", status: "PAYABLE" },
  { label: "Flagged", status: "FLAGGED" },
  { label: "Paid", status: "PAID" },
];

function parseStatus(raw: string | undefined): CommissionStatus | null {
  const upper = raw?.toUpperCase();
  return COMMISSION_STATUSES.find((s) => s === upper) ?? null;
}

// What this commission is waiting on, or what happened to it. One column for
// all five states, so a flagged row explains itself in the same place a paid
// one does rather than needing a screen of its own.
//
// Both flagReason and voidReason are internal tokens the worker writes, never
// shown raw: they always go through commissionReason.ts, so a stored token
// like "refund" or "email:buyer@x.com affiliate@x.com" never leaks into the
// ledger as-is.
function stateLabel(row: CommissionRow): string {
  // A live row a partial refund reduced carries its own reason regardless of
  // which pre-void status it is otherwise in.
  if (row.status !== "VOIDED" && row.voidReason === "partial refund") {
    const reduced = voidReasonText(row.voidReason, "owner");
    if (reduced) return reduced;
  }
  switch (row.status) {
    case "PENDING":
      return `Payable ${formatDate(row.payableAt)}`;
    case "PAYABLE":
      return "Ready to pay";
    case "FLAGGED":
      return flagReasonText(row.flagReason)?.title ?? "Flagged for review";
    case "PAID":
      return row.paidAt ? `Paid ${formatDate(row.paidAt)}` : "Paid";
    case "VOIDED": {
      const cause = voidReasonText(row.voidReason, "owner");
      const when = row.voidedAt ? formatDate(row.voidedAt) : null;
      if (cause && when) return `${cause} · ${when}`;
      return cause ?? (when ? `Voided ${when}` : "Voided");
    }
  }
}

// A Stripe reference is worth following, so it is a link into the dashboard
// the owner already has open. Anything that is not a payment or an invoice id
// is shown as it came, rather than guessed into a URL that would 404.
function referenceFor(ref: string | null): { text: string; href: string | null } | null {
  if (!ref) return null;
  if (ref.startsWith("pi_")) return { text: ref, href: `https://dashboard.stripe.com/payments/${ref}` };
  if (ref.startsWith("in_")) return { text: ref, href: `https://dashboard.stripe.com/invoices/${ref}` };
  return { text: ref, href: null };
}

function amountText(totals: CurrencyTotal[]): string {
  const hint = moneyHint(totals);
  return hint ? `${money(totals)} and ${hint}` : money(totals);
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
    commission?: string;
    error?: string;
    skipped?: string;
  }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const base = `/dashboard/products/${merchant.slug}`;
  const filters = {
    status: parseStatus(query.status),
    affiliateId: query.affiliate ?? null,
    currency: query.currency ?? null,
    query: query.q ?? null,
  };
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);

  // Taken before any commission is read. Mark paid compares it with when a
  // refund voided a shown row, so it has to be no later than the read.
  const renderedAt = new Date().toISOString();

  // Owed and payable now come from the same helper the overview uses, so the
  // two screens cannot disagree.
  const [{ rows, total }, options, { owed, payableNow }] = await Promise.all([
    listCommissions(ownerId, merchant.id, filters, { page, pageSize: COMMISSIONS_PAGE_SIZE }),
    getCommissionFilterOptions(ownerId, merchant.id),
    getOwedTotals(ownerId, merchant.id),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / COMMISSIONS_PAGE_SIZE));

  // Same hole as the affiliates list: a page number past the end rendered an
  // empty ledger under a label counting rows that are not there.
  if (page > totalPages) {
    const corrected = hrefWith({ page: totalPages > 1 ? String(totalPages) : null });
    redirect(`${base}/commissions${corrected === "?" ? "" : corrected}`);
  }

  const anyFilterActive = Boolean(
    filters.status || filters.affiliateId || filters.currency || filters.query
  );

  // Every href keeps what is already on and changes one thing, so switching
  // tab does not silently drop the affiliate you picked. The selected
  // commission is not one of them: it is added by the row that owns it.
  function hrefWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      status: filters.status,
      affiliate: filters.affiliateId,
      currency: filters.currency,
      q: filters.query,
      page: page > 1 ? String(page) : null,
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
    amount: formatMoney(row.amount, row.currency),
    status: row.status,
    affiliateName: row.affiliateName,
    affiliateEmail: row.affiliateEmail,
    isAdjustment: row.isAdjustment,
    createdLabel: formatDate(row.createdAt),
    stateLabel: stateLabel(row),
    reference: row.stripePaymentRef,
    href: hrefWith({ commission: row.id }),
  }));

  // Only a commission on the page being read can be opened: the id in the URL
  // is a selection within this list, not a route of its own.
  const selected = query.commission ? rows.find((r) => r.id === query.commission) ?? null : null;
  const sheetCommission: SheetCommission | null = selected
    ? {
        id: selected.id,
        status: selected.status,
        disputed: selected.disputed,
        amount: formatMoney(selected.amount, selected.currency),
        payTotal: selected.amount,
        // Only carried when it actually differs, so the sheet can tell "was
        // reduced" from "was always this" with a single null check.
        grossAmount:
          selected.grossAmount && selected.grossAmount !== selected.amount
            ? formatMoney(selected.grossAmount, selected.currency)
            : null,
        affiliate: selected.affiliateName ?? selected.affiliateEmail,
        affiliateEmail: selected.affiliateEmail,
        createdLabel: formatDate(selected.createdAt),
        payableLabel: formatDate(selected.payableAt),
        voidedLabel: selected.voidedAt ? formatDate(selected.voidedAt) : null,
        voidReason: selected.voidReason,
        flagReason: selected.flagReason,
        stateLabel: stateLabel(selected),
        reference: referenceFor(selected.stripePaymentRef),
        clickLabel: formatDate(selected.click.at),
        linkLabel: selected.click.linkCode
          ? `${selected.click.linkCode} · ${selected.click.destinationPath ?? "/"}`
          : null,
        isAdjustment: selected.isAdjustment,
        selfReferralConfirmed: selected.click.selfReferralConfirmed,
      }
    : null;

  const firstShown = total === 0 ? 0 : (page - 1) * COMMISSIONS_PAGE_SIZE + 1;
  const lastShown = Math.min(page * COMMISSIONS_PAGE_SIZE, total);

  // What closing the sheet goes back to: this same list, tab and filters kept.
  const unselected = hrefWith({});
  const listHref = `${base}/commissions${unselected === "?" ? "" : unselected}`;

  const refusal = refusalText(query.error);
  const skipped = skippedNote(query.skipped);

  return (
    <Page>
      <PageTitle
        title="Commissions"
        subtitle={`${amountText(owed)} owed, ${amountText(payableNow)} payable now`}
        actions={
          <Tabs value={filters.status ?? "all"}>
            <TabsList variant="line">
              {TABS.map((tab) => (
                <TabsTrigger
                  key={tab.label}
                  value={tab.status ?? "all"}
                  render={
                    <Link
                      href={hrefWith({ status: tab.status, page: null })}
                      className="cursor-pointer"
                    />
                  }
                >
                  {tab.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        }
      />

      {refusal && <p className="shrink-0 text-[13px] text-status-warning">{refusal}</p>}
      {skipped && <p className="shrink-0 text-[13px] text-muted-foreground">{skipped}</p>}

      {/* Flush and clipped: the rows are the card, and the table scrolls
          inside it so the page never does. */}
      <Section
        flush
        scroll
        className="overflow-hidden"
        actions={
          <CommissionFilters
            affiliates={options.affiliates}
            currencies={options.currencies}
            affiliateId={filters.affiliateId}
            currency={filters.currency}
            query={filters.query ?? ""}
            anyFilterActive={anyFilterActive}
          />
        }
      >
        <CommissionTable
          rows={ledgerRows}
          selectedId={selected?.id ?? null}
          filtered={anyFilterActive}
        />
      </Section>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-3">
        {total > 0 && (
          <p className="text-xs text-muted-foreground tabular-nums">
            {`${firstShown}-${lastShown} of ${total}`}
          </p>
        )}
        {totalPages > 1 && (
          <Pagination className="mx-0 w-auto justify-end">
            <PaginationContent>
              <PaginationItem>
                <PaginationPrevious
                  render={<Link href={hrefWith({ page: String(Math.max(1, page - 1)) })} />}
                  aria-disabled={page <= 1}
                />
              </PaginationItem>
              {pageList(page, totalPages).map((p, i) =>
                p === "gap" ? (
                  <PaginationItem key={`gap-${i}`}>
                    <PaginationEllipsis />
                  </PaginationItem>
                ) : (
                  <PaginationItem key={p}>
                    <PaginationLink
                      render={<Link href={hrefWith({ page: String(p) })} />}
                      isActive={p === page}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                )
              )}
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

      {sheetCommission && (
        <CommissionSheet
          commission={sheetCommission}
          product={{ id: merchant.id, slug: merchant.slug }}
          listHref={listHref}
          renderedAt={renderedAt}
        />
      )}
    </Page>
  );
}
