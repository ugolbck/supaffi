import { requireAffiliate } from "@/lib/affiliateAuth";
import { listLinksWithStats } from "@/lib/affiliateLink";
import { listPromoCodesWithStats } from "@/lib/promoCode";
import { LinksScreen } from "./LinksScreen";

export default async function AffiliateLinksPage() {
  const { affiliateId, merchant } = await requireAffiliate();
  const [links, promoCodes] = await Promise.all([listLinksWithStats(affiliateId), listPromoCodesWithStats(affiliateId)]);

  return <LinksScreen links={links} websiteUrl={merchant.websiteUrl} promoCodes={promoCodes} />;
}
