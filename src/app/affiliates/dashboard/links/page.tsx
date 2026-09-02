import { Link2, Plus } from "lucide-react";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { listLinksWithStats, MAX_LINKS_PER_AFFILIATE } from "@/lib/affiliateLink";
import { money, moneyHint } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { PageShell, PageHeader, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { LinksTable } from "./LinksTable";
import { LinkDialog } from "./LinkDialog";

/**
 * Every link the Affiliate can share, and the one control that matters on this
 * screen: making another one.
 *
 * Day one is exactly one link, which is what the layout is built for. The
 * ledger rules the rest of its card rather than leaving a slab of white, and
 * the rail's top card is that same link read as a result instead of a row, so
 * neither card is a line of text pinned to the top of a tall box.
 */

/**
 * One step of the best link's funnel: the count, the proportion it is of the
 * step above it, and the bar that makes the pair readable at a glance. Same
 * bar treatment as the owner's leaderboard.
 */
function Step({
  label,
  value,
  caption,
  fill,
}: {
  label: string;
  value: string;
  caption: string;
  /** 0 to 1. The track is always drawn; the bar only when there is something. */
  fill: number;
}) {
  return (
    <div className="flex flex-1 flex-col justify-center gap-1.5 border-b border-border/50 py-2">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className="truncate font-mono text-sm tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
        {fill > 0 && (
          <div
            className="h-full rounded-full bg-accent-500"
            style={{ width: `${Math.max(4, Math.round(fill * 100))}%` }}
          />
        )}
      </div>
      <span className="truncate text-[11px] text-muted-foreground tabular-nums">{caption}</span>
    </div>
  );
}

export default async function AffiliateLinksPage() {
  const { affiliateId, merchant } = await requireAffiliate();
  const links = await listLinksWithStats(affiliateId);

  const atMax = links.length >= MAX_LINKS_PER_AFFILIATE;

  // Most clicks wins. listLinksWithStats is primary first, then oldest first,
  // so a tie resolves to the signup link, which is the one the Affiliate has
  // been sharing longest.
  const best = links.reduce<(typeof links)[number] | null>(
    (top, link) => (top === null || link.clicks > top.clicks ? link : top),
    null
  );
  const totalClicks = links.reduce((sum, link) => sum + link.clicks, 0);

  return (
    <PageShell>
      <PageHeader
        title="Links"
        actions={
          atMax ? (
            // A disabled button swallows its own pointer events, so the
            // tooltip hangs off a wrapper rather than off the button.
            <Tooltip>
              <TooltipTrigger render={<span className="inline-flex cursor-not-allowed" />}>
                <Button size="sm" disabled className="cursor-pointer">
                  <Plus />
                  New link
                </Button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {`You can have up to ${MAX_LINKS_PER_AFFILIATE} links. Delete one to add another.`}
              </TooltipContent>
            </Tooltip>
          ) : (
            // The dialog owns its own trigger: see LinkDialog on why a trigger
            // element built here would hydrate wrong.
            <LinkDialog websiteUrl={merchant.websiteUrl} />
          )
        }
      />

      <Band columns={12}>
        <DashboardCard title="Links" className="lg:col-span-8" bodyPadding={false}>
          <LinksTable links={links} websiteUrl={merchant.websiteUrl} />
        </DashboardCard>

        {/* Same 1fr/auto template the owner's rails use: the top card needs a
            row with a resolved size for `h-full` to stretch into, and a flex
            column would put `h-full` and `flex-1` in a race decided by
            stylesheet order. */}
        <div className="grid grid-rows-[1fr_auto] gap-4 lg:col-span-4 lg:h-full lg:min-h-0">
          <DashboardCard title="Best performer">
            {/* An Affiliate always has their signup link, so this branch is a
                guard rather than a state anyone reaches. It still gets a
                designed empty state instead of an empty box. */}
            {best === null ? (
              <CardEmpty icon={Link2} title="No links yet." />
            ) : (
              <div className="flex min-h-0 flex-1 flex-col gap-2.5">
                <div className="flex shrink-0 flex-col gap-0.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-heading text-base font-semibold tracking-tight">
                      {best.code}
                    </span>
                    {best.isPrimary && <Badge variant="outline">Primary</Badge>}
                  </div>
                  <span
                    className={`truncate text-[11px] text-muted-foreground ${
                      best.destinationPath ? "font-mono" : ""
                    }`}
                  >
                    {best.destinationPath ?? "Site root"}
                  </span>
                </div>
                <div className="flex flex-1 flex-col">
                  <Step
                    label="Clicks"
                    value={String(best.clicks)}
                    fill={totalClicks === 0 ? 0 : best.clicks / totalClicks}
                    caption={
                      totalClicks === 0
                        ? "No clicks yet"
                        : `${Math.round((best.clicks / totalClicks) * 100)}% of your clicks`
                    }
                  />
                  <Step
                    label="Conversions"
                    value={String(best.conversions)}
                    fill={best.clicks === 0 ? 0 : best.conversions / best.clicks}
                    caption={
                      best.clicks === 0
                        ? "No clicks yet"
                        : `${Math.round((best.conversions / best.clicks) * 1000) / 10}% of its clicks`
                    }
                  />
                  {/* No bar on the last step: earnings have no denominator to
                      be a proportion of, and a bar that is always full would
                      be decoration. The money gets the size instead. */}
                  <div className="flex flex-1 flex-col justify-center gap-1 py-2">
                    <span className="text-xs font-medium text-muted-foreground">Earned</span>
                    <span className="font-heading truncate text-2xl leading-none font-semibold tracking-tight tabular-nums">
                      {money(best.earned)}
                    </span>
                    <span className="truncate font-mono text-[11px] text-muted-foreground tabular-nums">
                      {moneyHint(best.earned) ?? " "}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </DashboardCard>

          <DashboardCard title="How links work">
            <ul className="flex flex-col gap-1.5 text-xs leading-relaxed text-muted-foreground">
              <li>A destination points a link at one page, like /pricing. Blank is the site root.</li>
              <li>A code is 2 to 30 characters: lowercase letters, numbers and hyphens.</li>
              <li>Changing a code stops the old link working straight away.</li>
            </ul>
          </DashboardCard>
        </div>
      </Band>
    </PageShell>
  );
}
