"use client";

import { useRouter } from "next/navigation";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { changeProgramAction, setCustomRateAction } from "./affiliateActions";

/**
 * Everything about one affiliate, in one place, without leaving the list.
 *
 * The list selects with `?affiliate=<id>` and the panel is rendered on the
 * server from that, so there is no client copy of an affiliate to keep in step
 * with a write. Closing is a navigation back to the list, which is why the URL
 * it returns to arrives as a prop: the filters and the page were already in it.
 */

export type SheetAffiliate = {
  id: string;
  name: string | null;
  email: string;
  joinedAt: string;
  programId: string;
  programName: string;
  /** Without the percent sign. */
  rate: string;
  rateIsOverride: boolean;
  payoutDetails: string | null;
  links: { url: string; clicks: number }[];
  commissions: { id: string; date: string; amount: string; status: string }[];
};

export function AffiliateSheet({
  affiliate,
  programs,
  product,
  listHref,
}: {
  affiliate: SheetAffiliate;
  programs: { id: string; name: string }[];
  product: { id: string; slug: string };
  listHref: string;
}) {
  const router = useRouter();
  // The trigger shows a program name rather than the cuid the form submits.
  const programNames = Object.fromEntries(programs.map((p) => [p.id, p.name]));

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) router.push(listHref);
      }}
    >
      <SheetContent className="w-[420px] overflow-y-auto data-[side=right]:sm:max-w-[420px]">
        <SheetHeader className="pr-12">
          <SheetTitle className="truncate">{affiliate.name ?? affiliate.email}</SheetTitle>
          <SheetDescription className="truncate">
            {affiliate.email} · joined {affiliate.joinedAt}
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-6 px-4 pb-4">
          <form
            action={changeProgramAction.bind(null, product, affiliate.id)}
            className="flex items-center justify-between gap-3 text-sm"
          >
            <span className="text-muted-foreground">Program</span>
            <Select name="programId" items={programNames} defaultValue={affiliate.programId}>
              <SelectTrigger className="w-40 cursor-pointer" aria-label="Program">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {programs.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="cursor-pointer">
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
              Change
            </Button>
          </form>

          <form
            action={setCustomRateAction.bind(null, product, affiliate.id)}
            className="flex flex-col gap-2 text-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Rate</span>
              <span className="tabular-nums">
                {affiliate.rate}% {affiliate.rateIsOverride ? "(custom)" : "(program default)"}
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                name="rate"
                type="number"
                min="0.01"
                max="100"
                step="0.01"
                placeholder="Custom rate"
                className="w-32"
              />
              <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
                Set
              </Button>
              {affiliate.rateIsOverride && (
                // Submits an empty rate, which clears the override.
                <Button
                  type="submit"
                  size="sm"
                  variant="ghost"
                  className="cursor-pointer"
                  name="rate"
                  value=""
                >
                  Use default
                </Button>
              )}
            </div>
          </form>

          <div className="flex items-start justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Payout</span>
            <span className="max-w-60 text-right break-words">
              {affiliate.payoutDetails ?? "Not given yet"}
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Links</p>
            <ul className="flex flex-col gap-1 text-sm">
              {affiliate.links.map((l) => (
                <li key={l.url} className="flex justify-between gap-3">
                  <code className="truncate font-mono text-xs">{l.url}</code>
                  <span className="shrink-0 text-muted-foreground tabular-nums">
                    {l.clicks} clicks
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-col gap-2">
            <p className="text-sm font-medium">Commissions</p>
            <ul className="flex flex-col gap-1 text-sm">
              {affiliate.commissions.length === 0 && (
                <li className="text-muted-foreground">None yet</li>
              )}
              {affiliate.commissions.map((c) => (
                <li key={c.id} className="flex justify-between gap-3">
                  <span className="text-muted-foreground">{c.date}</span>
                  <span className="tabular-nums">{c.amount}</span>
                  <span className="w-16 text-right text-muted-foreground">{c.status}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
