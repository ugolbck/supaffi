import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Wallet } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getOwedTotals, getPayableGroups, listPayouts } from "@/lib/analytics";
import { formatCount, formatDate, formatMoney, money, moneyHint } from "@/lib/format";
import { refusalText, skippedNote } from "@/lib/payoutNotices";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { EmptyState } from "@/components/dashboard/EmptyState";
import { TablePagination } from "@/components/dashboard/TablePagination";
import { CopyValue } from "@/components/CopyValue";
import { markPayoutPaidAction } from "./payoutActions";

/**
 * The monthly job: who is owed what today, where to send it, and Mark paid.
 * Then every payout already made.
 *
 * One row per affiliate and currency, because that is what a payout is: the
 * ledger refuses a write that spans either. Each row binds the exact
 * commissions and amounts read at render time and the moment the page was
 * drawn, never a re-query at write time, so a commission that clears its hold
 * between paint and click is not swept in.
 */

const HISTORY_PAGE_SIZE = 25;

const HEAD = "h-9 text-[13px] font-medium text-neutral-700";

export default async function PayoutsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ page?: string; error?: string; skipped?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const ownerId = session.user.id;

  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const page = Math.max(1, Math.floor(Number(query.page)) || 1);
  // Taken before any commission is read. Mark paid compares it with when a
  // refund voided a shown row, so it has to be no later than the read.
  const renderedAt = new Date().toISOString();

  const [groups, history, { payableNow }] = await Promise.all([
    getPayableGroups(ownerId, merchant.id),
    listPayouts(ownerId, merchant.id, { page, pageSize: HISTORY_PAGE_SIZE }),
    getOwedTotals(ownerId, merchant.id),
  ]);

  const base = `/dashboard/products/${merchant.slug}`;
  const productRef = { id: merchant.id, slug: merchant.slug };
  const pageHref = (p: number) => `${base}/payouts${p > 1 ? `?page=${p}` : ""}`;

  const refusal = refusalText(query.error);
  const skipped = skippedNote(query.skipped);
  const hint = moneyHint(payableNow);

  return (
    <Page>
      <PageTitle
        title="Payouts"
        subtitle={groups.length > 0 ? `${money(payableNow)}${hint ? ` and ${hint}` : ""} ready to pay` : undefined}
      />

      {refusal && <p className="shrink-0 text-[13px] text-status-warning">{refusal}</p>}
      {skipped && <p className="shrink-0 text-[13px] text-muted-foreground">{skipped}</p>}

      <Section title="Ready to pay" flush className="shrink-0 overflow-hidden">
        {groups.length === 0 ? (
          <div className="border-t border-neutral-200">
            <EmptyState icon={<Wallet />} title="Nothing to pay" />
          </div>
        ) : (
          <div className="max-h-[45vh] overflow-auto border-t border-neutral-200">
            <Table>
              <TableHeader className="sticky top-0 z-10 bg-neutral-100">
                <TableRow className="border-neutral-200 hover:bg-transparent">
                  <TableHead className={HEAD}>Affiliate</TableHead>
                  <TableHead className={HEAD}>Pay to</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Commissions</TableHead>
                  <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
                  <TableHead className={HEAD} />
                </TableRow>
              </TableHeader>
              <TableBody className="divide-y divide-neutral-200">
                {groups.map((group) => (
                  <TableRow key={`${group.affiliateId}:${group.currency}`} className="border-neutral-200 hover:bg-neutral-50">
                    <TableCell className="max-w-56">
                      <Link
                        href={`${base}/affiliates?affiliate=${group.affiliateId}`}
                        className="block cursor-pointer truncate font-medium hover:underline"
                      >
                        {group.affiliateName ?? group.affiliateEmail}
                      </Link>
                      {group.affiliateName && (
                        <span className="block truncate text-xs text-muted-foreground">{group.affiliateEmail}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-72 text-sm">
                      {group.payoutDetails ? (
                        <CopyValue value={group.payoutDetails} />
                      ) : (
                        <span className="text-status-warning">Not given yet</span>
                      )}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground tabular-nums">
                      {formatCount(group.commissions.length)}
                    </TableCell>
                    <TableCell className="text-right text-[15px] font-medium whitespace-nowrap tabular-nums">
                      {formatMoney(group.total, group.currency)}
                    </TableCell>
                    <TableCell className="w-px text-right">
                      <form action={markPayoutPaidAction.bind(null, productRef, group.commissions, renderedAt)}>
                        <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
                          Mark paid
                        </Button>
                      </form>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Section>

      <Section title="Paid" flush scroll className="overflow-hidden">
        {history.total === 0 ? (
          <div className="border-t border-neutral-200">
            <EmptyState icon={<Wallet />} title="No payouts yet" />
          </div>
        ) : (
          <Table className="border-t border-neutral-200">
            <TableHeader className="sticky top-0 z-10 bg-neutral-100">
              <TableRow className="border-neutral-200 hover:bg-transparent">
                <TableHead className={HEAD}>Date</TableHead>
                <TableHead className={HEAD}>Affiliate</TableHead>
                <TableHead className={`${HEAD} text-right`}>Commissions</TableHead>
                <TableHead className={`${HEAD} text-right`}>Amount</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody className="divide-y divide-neutral-200">
              {history.rows.map((row) => (
                <TableRow
                  key={`${row.affiliateId}:${row.currency}:${row.paidAt.toISOString()}`}
                  className="border-neutral-200 hover:bg-neutral-50"
                >
                  <TableCell className="whitespace-nowrap text-muted-foreground tabular-nums">
                    {formatDate(row.paidAt)}
                  </TableCell>
                  <TableCell className="max-w-56">
                    <span className="block truncate">{row.affiliateName ?? row.affiliateEmail}</span>
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {formatCount(row.count)}
                  </TableCell>
                  <TableCell className="text-right font-medium whitespace-nowrap tabular-nums">
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
        hrefFor={pageHref}
      />
    </Page>
  );
}
