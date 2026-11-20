import { notFound } from "next/navigation";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { requireOwner } from "@/app/requireOwner";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getPayableGroups, listPayouts, type PayableGroup } from "@/lib/analytics";
import { formatCount, formatDate, formatMoney, money, moneyHint } from "@/lib/format";
import { alreadyPaidNote, recordedNote, refusalText, skippedNote } from "@/lib/payoutNotices";
import { methodLabel, parsePayoutDetails, PAYOUT_METHODS } from "@/lib/payoutMethod";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { TablePagination } from "@/components/dashboard/TablePagination";
import { PayoutQueue, type QueueRow } from "./PayoutQueue";
import { PayoutFilters } from "./PayoutFilters";

/**
 * The monthly job: who is owed what today, where to send it, and Mark paid.
 * Balances below their program's minimum payout wait on their own tab, and
 * every payout already made is on the last.
 *
 * One row per affiliate and currency, because that is what a payout is: the
 * ledger refuses a write that spans either.
 */

const HISTORY_PAGE_SIZE = 25;

const HEAD = "h-9 text-[13px] font-medium text-neutral-700";

type Tab = "ready" | "below" | "paid";

const NO_DETAILS = "none";

const METHOD_OPTIONS = [
  ...Object.entries(PAYOUT_METHODS).map(([value, { label }]) => ({ value, label })),
  { value: NO_DETAILS, label: "No details" },
];

function methodOf(group: PayableGroup): string {
  return group.payoutDetails?.trim() ? parsePayoutDetails(group.payoutDetails).method : NO_DETAILS;
}

export default async function PayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{
    tab?: string;
    currency?: string;
    method?: string;
    page?: string;
    error?: string;
    paid?: string;
    skipped?: string;
    already?: string;
    paidOn?: string;
    recorded?: string;
  }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const ownerId = await requireOwner();

  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const tab: Tab = query.tab === "below" || query.tab === "paid" ? query.tab : "ready";
  const currency = query.currency?.toLowerCase() || null;
  const method = query.method && METHOD_OPTIONS.some((o) => o.value === query.method) ? query.method : null;
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  // Taken before any commission is read. Mark paid compares it with when a
  // refund voided a shown row, so it has to be no later than the read.
  const renderedAt = new Date().toISOString();

  const [groups, history] = await Promise.all([
    getPayableGroups(ownerId, merchant.id),
    listPayouts(ownerId, merchant.id, { page, pageSize: HISTORY_PAGE_SIZE }, { currency, method }),
  ]);

  const ready = groups.filter((g) => !g.shortfall);
  const below = groups.filter((g) => g.shortfall);
  const shown = (tab === "below" ? below : ready).filter(
    (g) => (!currency || g.currency === currency) && (!method || methodOf(g) === method)
  );
  const currencies = [...new Set([...groups.map((g) => g.currency), ...history.currencies])].sort();

  const base = `/dashboard/products/${merchant.slug}`;
  const href = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams();
    const current: Record<string, string | null> = { tab: tab === "ready" ? null : tab, currency, method, ...changes };
    for (const [name, value] of Object.entries(current)) if (value) next.set(name, value);
    const search = next.toString();
    return `${base}/payouts${search ? `?${search}` : ""}`;
  };

  const notices = [
    { text: refusalText(query.error), warn: true },
    { text: recordedNote(query.paid), warn: false },
    { text: skippedNote(query.skipped), warn: false },
    { text: alreadyPaidNote(query.already, query.paidOn, query.recorded), warn: true },
  ].filter((n) => n.text);

  const rows: QueueRow[] = shown.map((g) => ({
    affiliateId: g.affiliateId,
    affiliateName: g.affiliateName,
    affiliateEmail: g.affiliateEmail,
    payoutDetails: g.payoutDetails,
    currency: g.currency,
    total: g.total,
    commissions: g.commissions,
    minimum: g.shortfall?.minimum ?? null,
  }));

  // What the first tab adds up to, per currency, as the commissions page totals it.
  const sums = new Map<string, number>();
  for (const g of ready) sums.set(g.currency, (sums.get(g.currency) ?? 0) + Number(g.total));
  const readyTotals = [...sums]
    .map(([c, sum]) => ({ currency: c, total: sum.toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
  const hint = moneyHint(readyTotals);

  const tabs: { id: Tab; label: string; count: number | null }[] = [
    { id: "ready", label: "Ready to pay", count: ready.length },
    { id: "below", label: "Below minimum", count: below.length },
    { id: "paid", label: "Paid", count: null },
  ];

  return (
    <Page>
      <PageTitle
        title="Payouts"
        subtitle={ready.length > 0 ? `${money(readyTotals)}${hint ? ` and ${hint}` : ""} ready to pay` : undefined}
      />

      {notices.map((n) => (
        <p key={n.text} className={`shrink-0 text-[13px] ${n.warn ? "text-status-warning" : "text-muted-foreground"}`}>
          {n.text}
        </p>
      ))}

      <div className="flex shrink-0 flex-wrap items-end justify-between gap-3">
        <Tabs value={tab}>
          <TabsList variant="line">
            {tabs.map((t) => (
              <TabsTrigger
                key={t.id}
                value={t.id}
                render={<Link href={href({ tab: t.id === "ready" ? null : t.id, page: null })} className="cursor-pointer" />}
              >
                {t.label}
                {t.count !== null && <span className="ml-1.5 text-muted-foreground tabular-nums">{t.count}</span>}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <PayoutFilters currencies={currencies} methods={METHOD_OPTIONS} currency={currency} method={method} />
      </div>

      {tab !== "paid" ? (
        <Section flush className="min-h-0 flex-1 overflow-hidden">
          {rows.length === 0 ? (
            <EmptyState
              icon={<Wallet />}
              title={
                currency || method
                  ? "Nothing matches these filters"
                  : tab === "below"
                    ? "No balances below a minimum"
                    : "Nothing to pay"
              }
            />
          ) : (
            <PayoutQueue
              // A new render after Mark paid starts with nothing ticked and the dialog closed.
              key={`${tab}:${currency}:${method}:${renderedAt}`}
              rows={rows}
              product={{ id: merchant.id, slug: merchant.slug }}
              view={{ tab, currency, method }}
              renderedAt={renderedAt}
              merchantName={merchant.name}
              affiliatesHref={`${base}/affiliates`}
            />
          )}
        </Section>
      ) : (
        <>
          <Section flush scroll className="overflow-hidden">
            {history.rows.length === 0 ? (
              <EmptyState icon={<Wallet />} title={currency || method ? "Nothing matches these filters" : "No payouts yet"} />
            ) : (
              <Table>
                <TableHeader className="sticky top-0 z-10 bg-neutral-100">
                  <TableRow className="border-neutral-200 hover:bg-transparent">
                    <TableHead className={`${HEAD} pl-4`}>Date</TableHead>
                    <TableHead className={HEAD}>Affiliate</TableHead>
                    <TableHead className={HEAD}>Method</TableHead>
                    <TableHead className={HEAD}>Reference</TableHead>
                    <TableHead className={HEAD}>Note</TableHead>
                    <TableHead className={`${HEAD} text-right`}>Commissions</TableHead>
                    <TableHead className={`${HEAD} pr-4 text-right`}>Amount</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="divide-y divide-neutral-200">
                  {history.rows.map((row) => (
                    <TableRow key={row.id} className="border-neutral-200 hover:bg-neutral-50">
                      <TableCell className="pl-4 whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatDate(row.paidAt)}
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="block truncate">{row.affiliateName ?? row.affiliateEmail}</span>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{methodLabel(row.method) ?? ""}</TableCell>
                      <TableCell className="max-w-48">
                        <span className="block truncate" title={row.reference ?? undefined}>
                          {row.reference ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className="max-w-56">
                        <span className="block truncate text-muted-foreground" title={row.note ?? undefined}>
                          {row.note ?? ""}
                        </span>
                      </TableCell>
                      <TableCell className="text-right text-muted-foreground tabular-nums">
                        {formatCount(row.count)}
                      </TableCell>
                      <TableCell className="pr-4 text-right font-medium whitespace-nowrap tabular-nums">
                        {formatMoney(row.total, row.currency)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Section>
          <TablePagination
            page={page}
            pageSize={HISTORY_PAGE_SIZE}
            total={history.total}
            hrefFor={(p) => href({ page: p > 1 ? String(p) : null })}
          />
        </>
      )}
    </Page>
  );
}
