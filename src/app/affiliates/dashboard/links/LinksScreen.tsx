import { Plus } from "lucide-react";
import { MAX_LINKS_PER_AFFILIATE, type AffiliateLinkStats } from "@/lib/affiliateLink";
import { Button } from "@/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Page, PageTitle, Section } from "@/components/dashboard/Page";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import type { PromoCodeRow } from "@/lib/promoCode";
import { LinksTable } from "./LinksTable";
import { LinkDialog } from "./LinkDialog";

/**
 * Every link the affiliate can share, and the one control that matters here:
 * making another one.
 *
 * One card, the same one the commissions ledger uses. What a code may contain
 * and what a destination does are the new-link dialog's job, said where the
 * field is, not repeated as a card of instructions beside the table.
 *
 * Presentational: the page reads the links and hands them over, so the screen
 * can be rendered in the dev kit with fixtures.
 */

/** How close to the ceiling counts as worth mentioning. */
const NEAR_THE_CEILING = 3;

export function LinksScreen({
  links,
  websiteUrl,
  promoCodes = [],
}: {
  links: AffiliateLinkStats[];
  websiteUrl: string;
  /** Codes the Owner gave them. A customer who uses one credits them, link or not. */
  promoCodes?: PromoCodeRow[];
}) {
  const atMax = links.length >= MAX_LINKS_PER_AFFILIATE;
  // Silent until it is nearly a problem. A hard limit nobody is near is a fact
  // about the software, not about them.
  const near = links.length >= MAX_LINKS_PER_AFFILIATE - NEAR_THE_CEILING;

  return (
    <Page>
      <PageTitle
        title="Links"
        subtitle={near ? `${links.length} of ${MAX_LINKS_PER_AFFILIATE} used` : undefined}
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
              <TooltipContent side="bottom">Delete one to add another.</TooltipContent>
            </Tooltip>
          ) : (
            // The dialog owns its own trigger: see LinkDialog on why a trigger
            // element built here would hydrate wrong.
            <LinkDialog websiteUrl={websiteUrl} />
          )
        }
      />

      {/* Content sized. An affiliate has one link far more often than twenty,
          and a card stretched to the viewport around three rows is a slab of
          white, not a fuller screen. */}
      <Section flush className="overflow-hidden">
        <LinksTable links={links} websiteUrl={websiteUrl} />
      </Section>

      {promoCodes.length > 0 && (
        <Section title="Promo codes" flush>
          <ul className="divide-y divide-border">
            {promoCodes.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 px-5 py-2.5">
                <code className="truncate font-mono text-sm">{c.code}</code>
                <CopyLinkButton size="sm" link={c.code} label="Copy" />
              </li>
            ))}
          </ul>
        </Section>
      )}
    </Page>
  );
}
