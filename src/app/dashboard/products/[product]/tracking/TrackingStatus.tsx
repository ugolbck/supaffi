import { Button } from "@/components/ui/button";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import type { CheckResult } from "@/lib/checks/dns";
import { siteHost } from "@/lib/onboarding";
import type { DayPoint } from "@/lib/analytics";
import { CodeBlock } from "@/components/onboarding/CodeBlock";

/**
 * Tracking, as a status page: is the script on the site, is anything arriving,
 * and the two snippets to copy again if it is not.
 *
 * The light comes from the shared check cache, which the page refreshes on
 * demand. An owner who has just pasted the tag wants to know whether it took,
 * and clicks only prove it after somebody visits.
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
  scriptPrompt,
  checkoutPromptText,
  checkAgain,
}: {
  merchant: { domain: string; websiteUrl: string };
  script: CheckResult;
  clicks: number;
  series: DayPoint[];
  lastClickAt: Date | null;
  verifiedAt: Date | null;
  scriptTag: string;
  checkoutSnippet: string;
  /** The plain text an owner forwards to whoever touches the code. */
  scriptPrompt: string;
  checkoutPromptText: string;
  checkAgain: () => Promise<void>;
}) {
  return (
    <Page>
      <PageTitle title="Tracking" subtitle={merchant.domain} />

      <Tiles>
        <StatTile
          label="Script"
          value={script.ok ? "Live" : "Not found"}
          hint={script.ok ? `on ${siteHost(merchant.websiteUrl)}` : `Looking on ${siteHost(merchant.websiteUrl)}`}
          tone={script.ok ? "success" : "warning"}
        />
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
        <CodeBlock title="Tracking script" code={scriptTag} prompt={scriptPrompt} />
      </Section>

      {/* The longer of the two snippets, and the only thing on this page tall
          enough to push the buttons under it off an 800px screen: it scrolls
          inside its own card so the page never does. */}
      <Section title="Checkout" scroll>
        <p className="mb-2 shrink-0 text-[13px] text-muted-foreground">
          Wherever you create the Stripe Checkout Session, server side.
        </p>
        <CodeBlock title="Checkout session" code={checkoutSnippet} prompt={checkoutPromptText} />
      </Section>

      <div className="flex shrink-0 flex-wrap items-center gap-2">
        <form action={checkAgain}>
          <Button type="submit" size="sm" variant="secondary" className="cursor-pointer">
            Check the site again
          </Button>
        </form>
      </div>
    </Page>
  );
}
