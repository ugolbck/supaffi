import { CopyLinkButton } from "@/components/CopyLinkButton";
import { Button } from "@/components/ui/button";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { Light } from "@/components/dashboard/Light";
import type { CheckResult } from "@/lib/checks/dns";
import type { DayPoint } from "@/lib/analytics";
import { Snippet } from "./TrackingSteps";

/**
 * Tracking, as a status page: is the script on the site, is anything arriving,
 * and the two snippets to copy again if it is not.
 *
 * The light comes from a live read of the owner's homepage at render time, not
 * from what the database last saw. An owner who has just pasted the tag wants
 * to know whether it took, and clicks only prove it after somebody visits.
 */

const DATE = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export function TrackingStatus({
  merchant,
  script,
  clicks,
  series,
  lastClickAt,
  verifiedAt,
  scriptTag,
  checkoutSnippet,
  brief,
  checkAgain,
}: {
  merchant: { domain: string };
  script: CheckResult;
  clicks: number;
  series: DayPoint[];
  lastClickAt: Date | null;
  verifiedAt: Date | null;
  scriptTag: string;
  checkoutSnippet: string;
  /** The plain text an owner forwards to whoever touches the code. */
  brief: string;
  checkAgain: () => Promise<void>;
}) {
  return (
    <Page>
      <PageTitle title="Tracking" subtitle={merchant.domain} />

      <Tiles>
        {/* A light, not a number: the only honest answer here is found or not,
            and it is always followed by a few words. */}
        <div className="flex flex-col justify-between gap-2 rounded-(--radius-lg) border border-border/70 bg-elevated [background-image:var(--elevated-surface)] px-3.5 py-3 shadow-[var(--edge-light),var(--shadow-xs)]">
          <span className="text-xs font-medium text-muted-foreground">Script</span>
          <Light result={script} label={script.ok ? "Found" : "Not found"} />
        </div>
        <StatTile
          label="Clicks, 30 days"
          value={String(clicks)}
          series={series.map((d) => d.clicks)}
        />
        <StatTile label="Last click" value={lastClickAt ? DATE.format(lastClickAt) : "None yet"} />
        <StatTile label="First sale" value={verifiedAt ? DATE.format(verifiedAt) : "Not yet"} />
      </Tiles>

      <Section title="Script tag">
        <p className="mb-2 text-[13px] text-muted-foreground">
          In the head of every page an affiliate link can land on.
        </p>
        <Snippet code={scriptTag} />
      </Section>

      <Section title="Checkout">
        <p className="mb-2 text-[13px] text-muted-foreground">
          Wherever you create the Stripe Checkout Session, server side.
        </p>
        <Snippet code={checkoutSnippet} />
      </Section>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <CopyLinkButton link={brief} size="sm" label="Copy a brief for a developer" />
        <form action={checkAgain}>
          <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
            Check the site again
          </Button>
        </form>
      </div>
    </Page>
  );
}
