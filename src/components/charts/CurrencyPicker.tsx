"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";

/**
 * Which currency the chart is drawn in.
 *
 * Only rendered when there is more than one, which for almost every product
 * is never. Money is not converted anywhere in Supaffi, so two currencies
 * are two charts to flip between rather than one chart of a made-up total.
 */
export function CurrencyPicker({
  value,
  options,
  className,
}: {
  value: string;
  /** Every currency sold in, most sales first. */
  options: string[];
  className?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();

  if (options.length < 2) return null;

  function choose(next: string | null) {
    if (!next || next === value || !options.includes(next)) return;
    const query = new URLSearchParams(params);
    // The first is the default, so it stays out of the URL.
    if (next === options[0]) query.delete("currency");
    else query.set("currency", next);
    const search = query.toString();
    startTransition(() => router.push(search ? `${pathname}?${search}` : pathname, { scroll: false }));
  }

  return (
    <Select
      value={value}
      onValueChange={choose}
      items={Object.fromEntries(options.map((code) => [code, code.toUpperCase()]))}
    >
      <SelectTrigger size="sm" className={cn("cursor-pointer text-[13px]", className)} aria-label="Currency">
        {pending && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {options.map((code) => (
          <SelectItem key={code} value={code}>
            {code.toUpperCase()}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
