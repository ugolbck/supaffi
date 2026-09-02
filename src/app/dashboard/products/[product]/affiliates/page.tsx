import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Percent, Trophy } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import {
  listAffiliatesForMerchant,
  getAffiliateSignals,
  getAffiliateDetails,
  AFFILIATES_PAGE_SIZE,
} from "@/lib/affiliate";
import { getProductMetrics, getTopAffiliates } from "@/lib/analytics";
import { getProductSetup, sectionGates, SECTION_UNLOCKED_BY } from "@/lib/productSetup";
import { money, moneyHint } from "@/lib/format";
import { originFor } from "@/lib/url";
import { REFERRAL_QUERY_PARAM } from "@/lib/referral";
import { Badge } from "@/components/ui/badge";
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
import { PageShell, PageHeader, SignalRow, Band } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { DashboardCard, CardEmpty } from "@/components/dashboard/DashboardCard";
import { AffiliateFilters } from "./AffiliateFilters";
import { AffiliateTable, type AffiliateRowView } from "./AffiliateTable";

/**
 * Everyone promoting this product, and what they have brought in.
 *
 * The list takes nine columns across the whole band; the rail takes three and
 * answers the two questions the list cannot: who is actually performing, and
 * how the next one signs up. A row opens a sheet rather than a route, so the
 * filters, the page and the scroll position all survive being read.
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
  searchParams: Promise<{ program?: string; q?: string; page?: string }>;
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

  // Affiliates sign up to a program, so with none there is nobody to list and
  // no link to hand out.
  const setup = await getProductSetup(ownerId, merchant.id);
  if (!sectionGates(setup).affiliates) redirect(`${base}${SECTION_UNLOCKED_BY.affiliates}`);

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

  const [{ rows, total }, signals, metrics, leaders] = await Promise.all([
    listAffiliatesForMerchant(ownerId, merchant.id, filters, {
      page,
      pageSize: AFFILIATES_PAGE_SIZE,
    }),
    getAffiliateSignals(ownerId, merchant.id),
    getProductMetrics(ownerId, merchant.id),
    getTopAffiliates(ownerId, merchant.id, 6),
  ]);

  const details = await getAffiliateDetails(
    ownerId,
    merchant.id,
    rows.map((r) => r.id)
  );

  const signupLink = firstProgram
    ? `${originFor(merchant.domain)}/affiliates/signup/${firstProgram.slug}`
    : null;

  const view: AffiliateRowView[] = rows.map((row) => {
    const detail = details[row.id];
    return {
      id: row.id,
      name: row.name,
      email: row.email,
      referralCode: row.referralCode,
      programName: row.programName,
      programHref: `${base}/programs/${row.programSlug}/edit`,
      clicks: row.clicks,
      conversions: row.conversions,
      earned: money(row.earned),
      earnedHint: moneyHint(row.earned) ?? null,
      rate: `${row.commissionRate}%`,
      rateIsOverride: row.rateIsOverride,
      joinedLabel: DATE.format(row.createdAt),
      referralLink: `${merchant.websiteUrl}?${REFERRAL_QUERY_PARAM}=${row.referralCode}`,
      payoutDetails: detail?.payoutDetails ?? null,
      commissions: (detail?.commissions ?? []).map((c) => ({
        id: c.id,
        amount: c.amount,
        currency: c.currency,
        status: c.status,
        dateLabel: SHORT_DATE.format(c.createdAt),
      })),
    };
  });

  const totalPages = Math.max(1, Math.ceil(total / AFFILIATES_PAGE_SIZE));

  // A hand-edited page number past the end would otherwise put an empty table
  // under a label counting rows that are not there. Clamping only the label
  // would swap one lie for another, so the URL is corrected instead.
  if (page > totalPages) {
    const query = hrefWith({ page: totalPages > 1 ? String(totalPages) : null });
    redirect(`${base}/affiliates${query === "?" ? "" : query}`);
  }

  const firstShown = total === 0 ? 0 : (page - 1) * AFFILIATES_PAGE_SIZE + 1;
  const lastShown = Math.min(page * AFFILIATES_PAGE_SIZE, total);

  // Every href keeps the filters already on and changes one thing.
  function hrefWith(changes: Record<string, string | null>): string {
    const params = new URLSearchParams();
    const current: Record<string, string | null> = {
      program: programSlug,
      q: filters.query,
      ...changes,
    };
    for (const [key, value] of Object.entries(current)) {
      if (value) params.set(key, value);
    }
    const search = params.toString();
    return search ? `?${search}` : "?";
  }

  const newProgramButton = (
    <Link href={`${base}/programs/new`}>
      <Button size="sm" className="cursor-pointer">
        New program
      </Button>
    </Link>
  );

  // The bar is rank weight, on the same basis getTopAffiliates ranks: the sum
  // of what an affiliate earned. The money beside it stays per currency,
  // because that is the number that means something.
  const weightOf = (earned: { total: string }[]) =>
    earned.reduce((sum, e) => sum + Number(e.total), 0);
  const topWeight = Math.max(...leaders.map((l) => weightOf(l.earned)), 1);

  return (
    <PageShell>
      <PageHeader
        title="Affiliates"
        subtitle={merchant.name}
        actions={
          signupLink ? (
            <CopyLinkButton size="sm" link={signupLink} label="Copy signup link" />
          ) : (
            newProgramButton
          )
        }
      />

      <SignalRow columns={5}>
        <StatTile
          label="Total"
          value={String(signals.total)}
          hint={`${signals.joinedThisMonth} joined this month`}
        />
        <StatTile
          label="Earning"
          value={String(signals.earning)}
          hint={`of ${signals.total}`}
        />
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
        <StatTile
          label="Owed"
          value={money(metrics.owed)}
          hint={moneyHint(metrics.owed)}
          tone={metrics.owed.length > 0 ? "success" : "neutral"}
        />
      </SignalRow>

      <Band columns={12}>
        <section className="flex h-full min-h-0 flex-col overflow-hidden rounded-(--radius-xl) border border-border/70 bg-card [background-image:var(--card-surface)] shadow-[var(--edge-light),var(--shadow-sm)] lg:col-span-9">
          <div className="shrink-0 border-b border-border/60 px-4 py-3">
            <AffiliateFilters
              programs={programs.map((p) => ({ slug: p.slug, name: p.name }))}
              programSlug={programSlug}
              query={filters.query ?? ""}
              anyFilterActive={anyFilterActive}
            />
          </div>

          <AffiliateTable
            rows={view}
            filtered={anyFilterActive}
            emptyAction={
              signupLink ? (
                <>
                  <code className="w-full truncate rounded-md bg-muted px-2 py-1.5 font-mono text-[11px] text-muted-foreground">
                    {signupLink}
                  </code>
                  <CopyLinkButton size="sm" link={signupLink} label="Copy signup link" />
                </>
              ) : (
                newProgramButton
              )
            }
          />

          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-border/60 px-4 py-2.5">
            <p className="text-xs text-muted-foreground tabular-nums">
              {total === 0 ? "No results" : `${firstShown}-${lastShown} of ${total}`}
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
                      render={
                        <Link href={hrefWith({ page: String(Math.min(totalPages, page + 1)) })} />
                      }
                      aria-disabled={page >= totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            )}
          </div>
        </section>

        {/* Same 1fr/auto template the ledger's rail uses: the top card needs a
            row with a resolved size for `h-full` to stretch into, and a flex
            column would put `h-full` and `flex-1` in a race decided by
            stylesheet order. */}
        <div className="grid grid-rows-[1fr_auto] gap-4 lg:col-span-3 lg:h-full lg:min-h-0">
          <DashboardCard title="Leaderboard">
            {leaders.length === 0 ? (
              // No action on this one. The Recruiting card directly below it
              // in the same rail already carries the signup link, and four
              // copies of the same button is what a new product would
              // otherwise open on.
              <CardEmpty icon={Trophy} title="Nobody has earned a commission yet" />
            ) : (
              // Rows share the card's height instead of stacking at the top,
              // which is what keeps this card full at one affiliate as well as
              // at six. The rule between them is what makes even bands read as
              // a deliberate distribution rather than a stretched list.
              <ul className="flex flex-1 flex-col">
                {leaders.map((leader, i) => (
                  <li
                    key={leader.id}
                    className="flex flex-1 flex-col justify-center gap-1.5 border-b border-border/50 py-2 last:border-0"
                  >
                    <div className="flex items-baseline gap-2 text-sm">
                      <span className="w-4 shrink-0 text-xs text-muted-foreground tabular-nums">
                        {i + 1}
                      </span>
                      <span className="min-w-0 flex-1 truncate">
                        {leader.name ?? leader.email}
                      </span>
                      <span className="shrink-0 font-mono text-xs tabular-nums">
                        {money(leader.earned)}
                      </span>
                    </div>
                    <div className="ml-6 h-1.5 overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full rounded-full bg-accent-500"
                        style={{
                          width: `${Math.max(4, (weightOf(leader.earned) / topWeight) * 100)}%`,
                        }}
                      />
                    </div>
                    <span className="ml-6 truncate text-[11px] text-muted-foreground tabular-nums">
                      {leader.clicks === 1 ? "1 click" : `${leader.clicks} clicks`}
                      {moneyHint(leader.earned) ? `  ·  ${moneyHint(leader.earned)}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </DashboardCard>

          <DashboardCard
            title="Recruiting"
            footer={
              firstProgram ? (
                <Link href={`${base}/programs/${firstProgram.slug}/edit`}>
                  <Button variant="outline" size="sm" className="w-full cursor-pointer">
                    Program terms
                  </Button>
                </Link>
              ) : (
                <Link href={`${base}/programs/new`}>
                  <Button variant="outline" size="sm" className="w-full cursor-pointer">
                    New program
                  </Button>
                </Link>
              )
            }
          >
            {firstProgram && signupLink ? (
              <div className="flex flex-col gap-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{firstProgram.name}</span>
                  <Badge variant="outline">{String(firstProgram.defaultCommissionRate)}%</Badge>
                </div>
                <div className="flex items-center gap-2">
                  <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-1.5 py-1 font-mono text-[11px] text-muted-foreground">
                    {signupLink}
                  </code>
                  <CopyLinkButton size="sm" link={signupLink} label="Copy" />
                </div>
                <span className="text-xs text-muted-foreground tabular-nums">
                  {signals.joinedThisMonth} joined this month
                </span>
              </div>
            ) : (
              <CardEmpty icon={Percent} title="No program to sign up to yet" />
            )}
          </DashboardCard>
        </div>
      </Band>
    </PageShell>
  );
}
