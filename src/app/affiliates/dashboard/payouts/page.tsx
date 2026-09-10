import { requireAffiliate } from "@/lib/affiliateAuth";
import { getAffiliateMetrics } from "@/lib/analytics";
import { getAffiliatePayoutDetails, listAffiliatePayments } from "@/lib/affiliate";
import { PayoutsScreen } from "./PayoutsScreen";

/**
 * What being paid looks like when Supaffi never touches the money: the
 * totals that answer "how much, and when", the payout details the merchant
 * pays against, and a history that is derived rather than a ledger of
 * transfers, because no transfer runs through this product.
 */
export default async function AffiliatePayoutsPage() {
  const { affiliateId, merchant } = await requireAffiliate();

  const [metrics, payoutDetails, payments] = await Promise.all([
    getAffiliateMetrics(affiliateId),
    getAffiliatePayoutDetails(affiliateId),
    listAffiliatePayments(affiliateId),
  ]);

  return (
    <PayoutsScreen
      merchantName={merchant.name}
      payoutDetails={payoutDetails}
      payments={payments}
      pending={metrics.pending}
      payable={metrics.payable}
      paid={metrics.paid}
    />
  );
}
