import { requireAffiliate } from "@/lib/affiliateAuth";
import { PageShell, PageHeader } from "@/components/dashboard/PageGrid";
import { CommissionHistory } from "../CommissionHistory";

function sanitizePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000);
}

export default async function AffiliateCommissionsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { affiliateId } = await requireAffiliate();
  const { page: pageParam } = await searchParams;
  const page = sanitizePage(pageParam);

  return (
    <PageShell>
      <PageHeader title="Commissions" />
      <CommissionHistory affiliateId={affiliateId} page={page} />
    </PageShell>
  );
}
