import Link from "next/link";
import { listAffiliateCommissions } from "@/lib/affiliate";
import { Badge } from "@/components/ui/badge";
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

const PAGE_SIZE = 10;

const STATUS_VARIANT: Record<string, "secondary" | "default" | "outline"> = {
  PENDING: "secondary",
  PAYABLE: "default",
  PAID: "outline",
  VOIDED: "outline",
};

function historyHref(page: number): string {
  return `?page=${page}`;
}

export async function CommissionHistory({
  affiliateId,
  page,
}: {
  affiliateId: string;
  page: number;
}) {
  const { rows, total } = await listAffiliateCommissions(affiliateId, { page, pageSize: PAGE_SIZE });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (total === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No commissions yet</EmptyTitle>
          <EmptyDescription>
            Commissions show up here once someone buys through your referral link.
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
              <TableHead>Date</TableHead>
              <TableHead>Amount</TableHead>
              <TableHead>Status</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r, i) => (
              <TableRow
                key={r.id}
                className="animate-in fade-in fill-mode-both duration-300"
                style={{ animationDelay: `${Math.min(i, 8) * 40}ms` }}
              >
                <TableCell>{r.createdAt.toLocaleDateString()}</TableCell>
                <TableCell className="font-mono tabular-nums">
                  {r.amount} {r.currency.toUpperCase()}
                </TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[r.status]}>{r.status}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                render={<Link href={historyHref(Math.max(1, page - 1))} />}
                aria-disabled={page <= 1}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink render={<Link href={historyHref(p)} />} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                render={<Link href={historyHref(Math.min(totalPages, page + 1))} />}
                aria-disabled={page >= totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
