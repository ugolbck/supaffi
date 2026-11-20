"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { FilterMenu } from "../commissions/CommissionFilters";

/**
 * Currency and payout method, one query parameter each, so a filtered view
 * can be linked and reloaded. The tab stays, the page resets.
 */
export function PayoutFilters({
  currencies,
  methods,
  currency,
  method,
}: {
  currencies: string[];
  methods: { value: string; label: string }[];
  currency: string | null;
  method: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  function push(name: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(name, value);
    else params.delete(name);
    params.delete("page");
    const next = params.toString();
    router.push(next ? `${pathname}?${next}` : pathname);
  }

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-2">
      {currencies.length > 1 && (
        <FilterMenu
          label="All currencies"
          active={currency}
          onPick={(value) => push("currency", value)}
          options={currencies.map((c) => ({ value: c, label: c.toUpperCase() }))}
        />
      )}
      <FilterMenu label="All methods" active={method} onPick={(value) => push("method", value)} options={methods} />
    </div>
  );
}
