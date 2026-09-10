import { requireAffiliate } from "@/lib/affiliateAuth";
import { listLinksWithStats } from "@/lib/affiliateLink";
import { LinksScreen } from "./LinksScreen";

export default async function AffiliateLinksPage() {
  const { affiliateId, merchant } = await requireAffiliate();
  const links = await listLinksWithStats(affiliateId);

  return <LinksScreen links={links} websiteUrl={merchant.websiteUrl} />;
}
