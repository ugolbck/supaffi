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

export async function PayoutsTab({
  ownerId,
  merchantId,
  page,
}: {
  ownerId: string;
  merchantId: string;
  page: number;
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
          {groups.map((g) => (
            <TableRow key={`${g.affiliateId}-${g.currency}`}>
              <TableCell>
                <div className="flex flex-col">
                  <span className="font-medium">{g.affiliateName ?? g.affiliateEmail}</span>
                  <span className="text-xs text-muted-foreground">{g.affiliateEmail}</span>
                </div>
              </TableCell>
              <TableCell className="uppercase">{g.currency}</TableCell>
              <TableCell>{g.commissionCount}</TableCell>
              <TableCell className="font-mono">{g.totalAmount}</TableCell>
              <TableCell className="flex justify-end gap-2">
                <PayoutDetailDialog
                  merchantId={merchantId}
                  affiliateId={g.affiliateId}
                  affiliateName={g.affiliateName ?? g.affiliateEmail}
                  currency={g.currency}
                />
                <MarkPaidButton
                  merchantId={merchantId}
                  affiliateId={g.affiliateId}
                  currency={g.currency}
                />
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
                href={page > 1 ? `?payoutsPage=${page - 1}` : undefined}
                aria-disabled={page <= 1}
              />
            </PaginationItem>
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
              <PaginationItem key={p}>
                <PaginationLink href={`?payoutsPage=${p}`} isActive={p === page}>
                  {p}
                </PaginationLink>
              </PaginationItem>
            ))}
            <PaginationItem>
              <PaginationNext
                href={page < totalPages ? `?payoutsPage=${page + 1}` : undefined}
                aria-disabled={page >= totalPages}
              />
            </PaginationItem>
          </PaginationContent>
        </Pagination>
      )}
    </div>
  );
}
