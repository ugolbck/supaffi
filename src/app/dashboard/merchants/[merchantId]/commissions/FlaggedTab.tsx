import { listFlaggedCommissions } from "@/lib/commission";
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
import { Badge } from "@/components/ui/badge";
import { ConfirmFraudButton } from "./ConfirmFraudButton";
import { DismissFlagButton } from "./DismissFlagButton";

const PAGE_SIZE = 10;

export async function FlaggedTab({
  ownerId,
  merchantId,
  page,
}: {
  ownerId: string;
  merchantId: string;
  page: number;
}) {
  const { commissions, total } = await listFlaggedCommissions(ownerId, merchantId, {
    page,
    pageSize: PAGE_SIZE,
  });
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  if (commissions.length === 0) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyTitle>No flagged commissions</EmptyTitle>
          <EmptyDescription>
            A self-referral signal flags a commission here for your review before it becomes payable.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Affiliate</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Flag reason</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {commissions.map((c) => (
            <TableRow key={c.id}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{c.affiliateName ?? c.affiliateEmail}</span>
                  <span className="text-xs text-muted-foreground">{c.affiliateEmail}</span>
                </div>
              </TableCell>
              <TableCell className="font-mono">
                {c.amount} {c.currency.toUpperCase()}
              </TableCell>
              <TableCell>
                <Badge className="bg-status-warning-bg text-status-warning">
                  {c.flagReason ?? "Flagged"}
                </Badge>
              </TableCell>
              <TableCell className="flex justify-end gap-2">
                <DismissFlagButton merchantId={merchantId} commissionId={c.id} />
                <ConfirmFraudButton merchantId={merchantId} commissionId={c.id} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      {totalPages > 1 && (
        <Pagination>
          <PaginationContent>
            <PaginationItem>
              <PaginationPrevious
                href={page > 1 ? `?flaggedPage=${page - 1}` : undefined}
                aria-disabled={page <= 1}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={`?flaggedPage=${p}`} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={page < totalPages ? `?flaggedPage=${page + 1}` : undefined}
                aria-disabled={page >= totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
