import { Card, CardContent } from "@/components/ui/card";
import type { AffiliateStats } from "@/lib/affiliate";

const STATUS_LABEL: Record<string, string> = {
  PENDING: "Pending",
  PAYABLE: "Payable",
  PAID: "Paid",
  VOIDED: "Voided",
};

export function StatsRow({ stats }: { stats: AffiliateStats }) {
  const currencies = [...new Set(stats.totals.map((t) => t.currency))].sort();

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Card>
        <CardContent className="flex flex-col gap-1">
          <span className="text-sm text-muted-foreground">Total clicks</span>
          <span className="font-heading text-2xl font-semibold tabular-nums">
            {stats.totalClicks}
          </span>
        </CardContent>
      </Card>

      {currencies.length === 0 ? (
        <Card>
          <CardContent className="flex items-center">
            <span className="text-sm text-muted-foreground">No commissions yet.</span>
          </CardContent>
        </Card>
      ) : (
        currencies.map((currency) => (
          <Card key={currency}>
            <CardContent className="flex flex-col gap-2">
              <span className="text-sm text-muted-foreground">{currency.toUpperCase()}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-1">
                {stats.totals
                  .filter((t) => t.currency === currency)
                  .map((t) => (
                    <div key={t.status} className="flex flex-col">
                      <span className="text-xs text-muted-foreground">
                        {STATUS_LABEL[t.status]}
                      </span>
                      <span className="font-mono text-sm tabular-nums">{t.amount}</span>
                    </div>
                  ))}
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
