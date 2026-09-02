import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliateStats } from "@/lib/affiliate";
import { PageShell, PageHeader } from "@/components/dashboard/PageGrid";
import { StatsRow } from "./StatsRow";

export default async function AffiliateOverviewPage() {
  const { affiliateId } = await requireAffiliate();
  const stats = await getAffiliateStats(affiliateId);

  return (
    <PageShell>
      <PageHeader title="Overview" />
      <StatsRow stats={stats} />
    </PageShell>
  );
}
