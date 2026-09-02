import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { Plus } from "lucide-react";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { listProgramsForMerchant } from "@/lib/program";
import { getAffiliateSignals } from "@/lib/affiliate";
import { getProductMetrics } from "@/lib/analytics";
import { money, moneyHint } from "@/lib/format";
import { originFor } from "@/lib/url";
import { Button } from "@/components/ui/button";
import { PageShell, PageHeader, SignalRow, Band, cardGrid } from "@/components/dashboard/PageGrid";
import { StatTile } from "@/components/dashboard/StatTile";
import { GhostCard } from "@/components/dashboard/GhostCard";
import { ProgramCard } from "./ProgramCard";

/**
 * Every commission Program this product runs, and the one place to create or
 * edit one. Programs used to only be reachable through links scattered on
 * other screens (the overview's summary card, the affiliates rail); this is
 * where those links now point.
 */

// One decimal, no trailing zero: 33.3% reads as computed, 30% doesn't need
// the .0 a naive toFixed(1) would tack on.
function formatPercent(rate: number): string {
  const rounded = Math.round(rate * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded : rounded.toFixed(1)}%`;
}

export default async function ProgramsPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const ownerId = session.user.id;
  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const base = `/dashboard/products/${merchant.slug}`;

  const [programs, signals, metrics] = await Promise.all([
    listProgramsForMerchant(ownerId, merchant.id),
    getAffiliateSignals(ownerId, merchant.id),
    getProductMetrics(ownerId, merchant.id),
  ]);

  // Unweighted: a Program with one Affiliate counts the same as one with a
  // hundred. This tile answers "what do we typically offer", not "what do we
  // typically pay out".
  const averageRate =
    programs.length === 0
      ? null
      : programs.reduce((sum, p) => sum + Number(p.defaultCommissionRate), 0) / programs.length;

  const grid = cardGrid(programs.length);

  return (
    <PageShell>
      <PageHeader
        title="Programs"
        subtitle={merchant.name}
        actions={
          <Link href={`${base}/programs/new`}>
            <Button size="sm" className="cursor-pointer">
              <Plus />
              New program
            </Button>
          </Link>
        }
      />

      <SignalRow columns={4}>
        <StatTile label="Programs" value={String(programs.length)} />
        <StatTile label="Affiliates" value={String(signals.total)} />
        <StatTile
          label="Average rate"
          value={averageRate === null ? "None" : formatPercent(averageRate)}
        />
        <StatTile label="Paid out" value={money(metrics.paid)} hint={moneyHint(metrics.paid)} />
      </SignalRow>

      <Band columns={grid.columns} scrolls>
        {programs.map((program) => (
          <ProgramCard
            key={program.id}
            name={program.name}
            defaultCommissionRate={Number(program.defaultCommissionRate)}
            commissionDurationType={program.commissionDurationType}
            commissionDurationMonths={program.commissionDurationMonths}
            attributionWindowDays={program.attributionWindowDays}
            holdingPeriodDays={program.holdingPeriodDays}
            affiliateCount={program.affiliateCount}
            signupLink={`${originFor(merchant.domain)}/affiliates/signup/${program.slug}`}
            editHref={`${base}/programs/${program.slug}/edit`}
            // The affiliates list's filter reads `program` as a slug (see
            // AffiliateFilters), the same way every other route here
            // addresses a Program, so that's what this link carries too.
            affiliatesHref={`${base}/affiliates?program=${program.slug}`}
          />
        ))}
        {/* Ends the row flush. One program would otherwise leave a hole. */}
        <GhostCard href={`${base}/programs/new`} label="New program" span={grid.ghostSpan} />
      </Band>
    </PageShell>
  );
}
