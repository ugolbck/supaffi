import { requireAffiliate } from "@/lib/affiliateAuth";
import { listLinksWithStats } from "@/lib/affiliateLink";
import { PageShell, PageHeader, Band } from "@/components/dashboard/PageGrid";
import { DashboardCard } from "@/components/dashboard/DashboardCard";

export default async function AffiliateLinksPage() {
  const { affiliateId } = await requireAffiliate();
  const links = await listLinksWithStats(affiliateId);

  return (
    <PageShell>
      <PageHeader title="Links" />
      <Band columns={1}>
        <DashboardCard title="Your links">
          <ul className="flex flex-col gap-2">
            {links.map((link) => (
              <li key={link.id} className="font-mono text-sm">
                {link.code}
              </li>
            ))}
          </ul>
        </DashboardCard>
      </Band>
    </PageShell>
  );
}
