import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { money, moneyHint } from "@/lib/format";
import type { PromoCodeStats } from "@/lib/promoCode";

/**
 * The promo codes the Owner gave this affiliate, on the links table's own
 * treatment and columns, minus clicks: nobody clicks a code. Read only; the
 * Owner adds and removes them.
 */
export function PromoCodesTable({ codes }: { codes: PromoCodeStats[] }) {
  return (
    <>
      <ul className="divide-y divide-neutral-200 md:hidden">
        {codes.map((code) => (
          <li key={code.id} className="flex flex-col gap-2 px-4 py-3">
            <span className="truncate font-mono font-medium">{code.code}</span>
            <div className="flex items-baseline justify-between gap-3">
              <span className="min-w-0 truncate text-[13px] text-muted-foreground tabular-nums">
                {code.conversions} sales
              </span>
              <span className="shrink-0 text-[13px] font-medium text-neutral-900 tabular-nums">
                {money(code.earned)}
              </span>
            </div>
            <div className="[&_button]:w-full">
              <CopyLinkButton size="sm" link={code.code} label="Copy code" />
            </div>
          </li>
        ))}
      </ul>

      <Table className="hidden table-fixed md:table">
        <TableHeader className="sticky top-0 z-10 bg-neutral-100">
          <TableRow className="border-neutral-200 hover:bg-transparent">
            <TableHead className="h-9 w-[56%] text-[13px] font-medium text-neutral-700">
              Promo code
            </TableHead>
            <TableHead className="h-9 w-[10%] text-right text-[13px] font-medium text-neutral-700">
              Sales
            </TableHead>
            <TableHead className="h-9 w-[18%] text-right text-[13px] font-medium text-neutral-700">
              Earned
            </TableHead>
            <TableHead className="h-9 w-[16%]">
              <span className="sr-only">Actions</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        <TableBody className="divide-y divide-neutral-200">
          {codes.map((code) => {
            const hint = moneyHint(code.earned);
            return (
              <TableRow key={code.id} className="border-neutral-200 hover:bg-neutral-50">
                <TableCell className="py-3">
                  <span className="block truncate font-mono font-medium">{code.code}</span>
                </TableCell>
                <TableCell className="text-right text-muted-foreground tabular-nums">
                  {code.conversions}
                </TableCell>
                <TableCell className="text-right">
                  <span className="block text-[15px] font-medium whitespace-nowrap text-neutral-900 tabular-nums">
                    {money(code.earned)}
                  </span>
                  {hint && (
                    <span className="block text-[11px] text-muted-foreground tabular-nums">{hint}</span>
                  )}
                </TableCell>
                <TableCell className="py-3">
                  {/* Where the links table keeps its menu too, so the Copy
                      buttons of both tables line up. */}
                  <span className="flex items-center justify-end gap-1.5 pr-[34px]">
                    <CopyLinkButton size="sm" link={code.code} label="Copy" />
                  </span>
                </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </>
  );
}
