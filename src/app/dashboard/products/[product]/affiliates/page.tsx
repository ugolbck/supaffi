import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import {
  listAffiliatesForMerchant,
  getAffiliateSignals,
  getAffiliateDetails,
  referralCounts,
  AFFILIATES_PAGE_SIZE,
} from "@/lib/affiliate";
import { getProductMetrics } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { originFor } from "@/lib/url";
import { linkUrl, listLinksWithStats } from "@/lib/affiliateLink";
import { Button } from "@/components/ui/button";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import { Page, PageTitle, Tiles, Section } from "@/components/dashboard/Page";
import { StatTile } from "@/components/dashboard/StatTile";
import { AffiliateFilters } from "./AffiliateFilters";
import { AffiliateTable, type AffiliateRowView } from "./AffiliateTable";
import { AffiliateSheet, type SheetAffiliate } from "./AffiliateSheet";

/**
 * Everyone promoting this product, and what they have brought in.
 *
 * One affiliate is read in a sheet the URL selects, so the panel is rendered
 * here rather than held on the client: a program change or a rate override
 * lands back on this page and the sheet is simply drawn again from the new
 * rows. The leaderboard that used to sit beside the list is gone; ranking
 * affiliates is the overview's job and the list already sorts and filters.
 */

const DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

const SHORT_DATE = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  timeZone: "UTC",
});

export default async function AffiliatesPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ program?: string; q?: string; page?: string; affiliate?: string }>;
}) {
  const { product } = await params;
  const query = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const base = `/dashboard/products/${merchant.slug}`;
  const page = Math.max(1, Math.floor(Number(query.page)) || 1);

  const programs = await listProgramsForMerchant(ownerId, merchant.id);
  const firstProgram = programs[0] ?? null;

  // The URL carries a program slug like every other route here, so the filter
  // is resolved to an id rather than a cuid ever reaching the address bar.
  const programSlug = query.program ?? null;
  const filterProgram = programSlug ? programs.find((p) => p.slug === programSlug) ?? null : null;
  const filters = {
    programId: filterProgram?.id ?? null,
    query: query.q ?? null,
  };
  const anyFilterActive = Boolean(filters.programId || filters.query);

  const [{ rows, total }, signals, metrics] = await Promise.all([
    listAffiliatesForMerchant(ownerId, merchant.id, filters, {
      page,
      pageSize: AFFILIATES_PAGE_SIZE,
    }),
    getAffiliateSignals(ownerId, merchant.id),
    getProductMetrics(ownerId, merchant.id),
  ]);

  const signupLink = firstProgram
    ? `${originFor(merchant.domain)}/affiliates/signup/${firstProgram.slug}`
    : null;

  const totalPages = Math.max(1, Math.ceil(total / AFFILIATES_PAGE_SIZE));

  // A hand-edited page number past the end would otherwise put an empty table
  // under a label counting rows that are not there. Clamping only the label
  // would swap one lie for another, so the URL is corrected instead.
  if (page > totalPages) {
    const corrected = hrefWith({ page: totalPages > 1 ? String(totalPages) : null });
    redirect(`${base}/affiliates${corrected === "?" ? "" : corrected}`);
  }

  const firstShown = total === 0 ? 0 : (page - 1) * AFFILIATES_PAGE_SIZE + 1;
  const lastShown = Math.min(page * AFFILIATES_PAGE_SIZE, total);

  // Every href keeps the filters already on and changes one thing. The
  // selected affiliate is one of them, which is what makes a row a link.
  function hrefWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      program: programSlug,
      q: filters.query,
      page: page > 1 ? String(page) : null,
      ...changes,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const search = params.toString();
    return search ? `?${search}` : "?";
  }

  // Task D3: how many of an affiliate's referrals still pay. Batched behind a
  // single Promise.all keyed on this page's own ids (referralCounts, Task
  // A5), never called per row inside the render below. programs is already
  // fetched above for the filter bar, so which program even has a "still
  // paying" question to answer costs no extra query.
  const counts = await Promise.all(rows.map((row) => referralCounts(row.id)));
  const referralCountsById = new Map(rows.map((row, i) => [row.id, counts[i]]));
  const recurringByProgramId = new Map(
    programs.map((p) => [p.id, p.commissionDurationType !== "ONE_TIME"])
  );

  const view: AffiliateRowView[] = rows.map((row) => {
    const counts = referralCountsById.get(row.id);
    const recurring = recurringByProgramId.get(row.programId) ?? false;
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      referralCode: row.referralCode,
      programName: row.programName,
      clicks: row.clicks,
      conversions: row.conversions,
      earned: money(row.earned),
      earnedHint: moneyHint(row.earned) ?? null,
      rate: `${row.commissionRate}%`,
      rateIsOverride: row.rateIsOverride,
      // Nothing when the program has no recurring commission to churn out of,
      // or when nobody has converted yet.
      retention:
        recurring && counts && counts.total > 0 ? `${counts.active} of ${counts.total} still paying` : null,
      joined: DATE.format(row.createdAt),
      href: hrefWith({ affiliate: row.id }),
    };
  });

  // Only an affiliate on the page being read can be opened: the id in the URL
  // is a selection within this list, not a route of its own.
  const selected = query.affiliate ? rows.find((r) => r.id === query.affiliate) ?? null : null;

  let sheetAffiliate: SheetAffiliate | null = null;
  if (selected) {
    const [details, links] = await Promise.all([
      getAffiliateDetails(ownerId, merchant.id, [selected.id]),
      listLinksWithStats(selected.id),
    ]);
    const detail = details[selected.id];
    sheetAffiliate = {
      id: selected.id,
      name: selected.name,
      email: selected.email,
      joinedAt: DATE.format(selected.createdAt),
      programId: selected.programId,
      programName: selected.programName,
      rate: selected.commissionRate,
      rateIsOverride: selected.rateIsOverride,
      payoutDetails: detail?.payoutDetails ?? null,
      links: links.map((l) => ({
        url: linkUrl(merchant.websiteUrl, l),
        clicks: l.clicks,
      })),
      commissions: (detail?.commissions ?? []).map((c) => ({
        id: c.id,
        date: SHORT_DATE.format(c.createdAt),
        // Never summed across currencies, so each line carries its own.
        amount: `${c.amount} ${c.currency.toUpperCase()}`,
        status: c.status.toLowerCase(),
      })),
    };
  }

  const newProgramButton = (
    <Button size="sm" className="cursor-pointer" render={<Link href={`${base}/programs?new=1`} />}>
      New program
    </Button>
  );

  const programCount = programs.length === 1 ? "1 program" : `${programs.length} programs`;

  // What closing the sheet goes back to: this same list, filters and page kept.
  const unselected = hrefWith({ affiliate: null });
  const listHref = `${base}/affiliates${unselected === "?" ? "" : unselected}`;

  return (
    <Page>
      <PageTitle
        title="Affiliates"
        subtitle={`${signals.total} in ${programCount}`}
        actions={
          <>
            <AffiliateFilters
              programs={programs.map((p) => ({ slug: p.slug, name: p.name }))}
              programSlug={programSlug}
              query={filters.query ?? ""}
              anyFilterActive={anyFilterActive}
            />
            {signupLink ? (
              <CopyLinkButton size="sm" link={signupLink} label="Copy link" />
            ) : (
              newProgramButton
            )}
          </>
        }
      />

      {/* Nothing to trend before anybody has joined, so the row is not drawn
          rather than drawn as zeroes. */}
      {signals.total > 0 && (
        <Tiles columns={3}>
          <StatTile
            label="Clicks, 30 days"
            value={String(metrics.clicks)}
            series={metrics.series.map((d) => d.clicks)}
          />
          <StatTile
            label="Conversion"
            value={`${metrics.conversionRate}%`}
            hint={`${metrics.conversions} of ${metrics.clicks}`}
          />
          <StatTile label="Owed" value={money(metrics.owed)} hint={moneyHint(metrics.owed)} />
        </Tiles>
      )}

      {/* Flush and clipped: the rows are the card, and the table scrolls
          inside it so the page never does. */}
      <Section flush scroll className="overflow-hidden">
        <AffiliateTable
          rows={view}
          selectedId={selected?.id ?? null}
          filtered={anyFilterActive}
          emptyAction={
            signupLink ? (
              <CopyLinkButton size="sm" link={signupLink} label="Copy link" />
            ) : (
              newProgramButton
            )
          }
        />
      </Section>

      {total > 0 && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground tabular-nums">
            {`${firstShown}-${lastShown} of ${total}`}
          </p>
          {totalPages > 1 && (
            <Pagination className="mx-0 w-auto justify-end">
              <PaginationContent>
                <PaginationItem>
                  <PaginationPrevious
                    render={<Link href={hrefWith({ page: String(Math.max(1, page - 1)) })} />}
                    aria-disabled={page <= 1}
                  />
                </PaginationItem>
                {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
                  <PaginationItem key={p}>
                    <PaginationLink
                      render={<Link href={hrefWith({ page: String(p) })} />}
                      isActive={p === page}
                    >
                      {p}
                    </PaginationLink>
                  </PaginationItem>
                ))}
                <PaginationItem>
                  <PaginationNext
                    render={<Link href={hrefWith({ page: String(Math.min(totalPages, page + 1)) })} />}
                    aria-disabled={page >= totalPages}
                  />
                </PaginationItem>
              </PaginationContent>
            </Pagination>
          )}
        </div>
      )}

      {sheetAffiliate && (
        <AffiliateSheet
          affiliate={sheetAffiliate}
          programs={programs.map((p) => ({ id: p.id, name: p.name }))}
          product={{ id: merchant.id, slug: merchant.slug }}
          listHref={listHref}
        />
      )}
    </Page>
  );
}
