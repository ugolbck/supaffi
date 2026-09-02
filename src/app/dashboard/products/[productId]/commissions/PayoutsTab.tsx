import Link from "next/link";
import { listPayableGroups } from "@/lib/commission";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { MarkPaidButton } from "./MarkPaidButton";
import { PayoutDetailDialog } from "./PayoutDetailDialog";

const PAGE_SIZE = 10;

function payoutsHref(page: number, flaggedPage: number): string {
  return `?tab=payouts&payoutsPage=${page}&flaggedPage=${flaggedPage}`;
}

export async function PayoutsTab({
  ownerId,
  merchantId,
  page,
  otherPage,
}: {
  ownerId: string;
  merchantId: string;
  page: number;
  otherPage: number;
}) {
  const { groups, totalGroups } = await listPayableGroups(ownerId, merchantId, {
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(totalGroups / PAGE_SIZE));

  if (groups.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>Nothing payable yet</EmptyTitle>
          <EmptyDescription>
            Commissions appear here once their Holding Period passes.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card shadow-sm">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Affiliate</TableHead>
            <TableHead>Currency</TableHead>
            <TableHead>Commissions</TableHead>
            <TableHead>Total</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {groups.map((g, i) => {
            const isNegative = g.totalAmount.startsWith("-");
            return (
              <TableRow
                key={`${g.affiliateId}-${g.currency}`}
                className="animate-in fade-in fill-mode-both duration-300"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <TableCell>
                  <div className="flex flex-col">
                    <span className="font-medium">{g.affiliateName ?? g.affiliateEmail}</span>
                    <span className="text-xs text-muted-foreground">{g.affiliateEmail}</span>
                  </div>
                </TableCell>
                <TableCell className="uppercase">{g.currency}</TableCell>
                <TableCell className="tabular-nums">{g.commissionCount}</TableCell>
                <TableCell className="font-mono tabular-nums">{g.totalAmount}</TableCell>
                <TableCell className="flex justify-end gap-2">
                  <PayoutDetailDialog
                    merchantId={merchantId}
                    affiliateId={g.affiliateId}
                    affiliateName={g.affiliateName ?? g.affiliateEmail}
                    currency={g.currency}
                  />
                  {isNegative ? (
                    <span className="flex items-center text-xs text-muted-foreground">
                      Carries to next payout
                    </span>
                  ) : (
                    <MarkPaidButton
                      merchantId={merchantId}
                      affiliateId={g.affiliateId}
                      currency={g.currency}
                      commissionIds={g.commissionIds}
                    />
                  )}
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                render={<Link href={payoutsHref(Math.max(1, page - 1), otherPage)} />}
                aria-disabled={page <= 1}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink
                  render={<Link href={payoutsHref(p, otherPage)} />}
                  isActive={p === page}
                >
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                render={<Link href={payoutsHref(Math.min(totalPages, page + 1), otherPage)} />}
                aria-disabled={page >= totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
