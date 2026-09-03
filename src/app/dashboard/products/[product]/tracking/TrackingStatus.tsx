import { Radio } from "lucide-react";
import { PageShell, PageHeader, SignalRow, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { StatTile } from "@/components/dashboard/StatTile";
import { BarChart } from "@/components/charts/BarChart";
import type { DayPoint } from "@/lib/analytics";
import type { TrackingStatus as TrackingState } from "@/lib/tracking";
import { TrackingSteps } from "./TrackingSteps";

/**
 * Tracking, once setup is done: the two snippets stay (they are always worth
 * re-copying), joined by the two dates and the chart that prove they are
 * actually working (docs/design/wireframes.md, section 6/8).
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function TrackingStatus({
  merchant,
  status,
  lastClickAt,
  verifiedAt,
  clicks,
  series,
  scriptTag,
}: {
  merchant: { name: string; domain: string };
  status: TrackingState;
  lastClickAt: Date | null;
  verifiedAt: Date | null;
  clicks: number;
  series: DayPoint[];
  scriptTag: string;
}) {
  const live = status === "verified";

  return (
    <PageShell>
      <PageHeader title="Tracking" subtitle={`${merchant.name} · ${merchant.domain}`} />

      <SignalRow columns={4}>
        <StatTile
          label="Status"
          value={live ? "Live" : "Awaiting a sale"}
          tone={live ? "success" : "neutral"}
        />
        <StatTile
          label="Clicks, 30 days"
          value={String(clicks)}
          series={series.map((d) => d.clicks)}
        />
        <StatTile label="Last click" value={lastClickAt ? DATE.format(lastClickAt) : "None yet"} />
        <StatTile
          label="Last attributed sale"
          value={verifiedAt ? DATE.format(verifiedAt) : "Not yet"}
        />
      </SignalRow>

      <Band columns={2}>
        <DashboardCard title="Snippets" bodyScrolls>
          <TrackingSteps scriptTag={scriptTag} />
        </DashboardCard>

        <DashboardCard
          title="Clicks per day"
          action={<span className="text-xs text-muted-foreground">Last 30 days</span>}
        >
          {clicks === 0 ? (
            <CardEmpty icon={Radio} title="No clicks in the last 30 days." />
          ) : (
            <BarChart series={series} />
          )}
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
