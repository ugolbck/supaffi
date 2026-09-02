import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliatePayoutDetails } from "@/lib/affiliate";
import { PageShell, PageHeader } from "@/components/dashboard/PageGrid";
import { PayoutDetailsForm } from "../PayoutDetailsForm";

export default async function AffiliatePayoutsPage() {
  const { affiliateId } = await requireAffiliate();
  const payoutDetails = await getAffiliatePayoutDetails(affiliateId);

  return (
    <PageShell>
      <PageHeader title="Payouts" />
      <PayoutDetailsForm initial={payoutDetails ?? ""} />
    </PageShell>
  );
}
