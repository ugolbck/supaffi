import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { requestHost } from "@/lib/requestHost";
import { db } from "@/lib/db";
import { merchantOnHost } from "./merchantOnHost";

/**
 * The guard every screen under /affiliates/dashboard runs.
 *
 * Two checks, not one. The session says who the Affiliate is; the host says
 * which Merchant's site they are on. An Affiliate of one Merchant loading
 * another Merchant's dashboard has a valid session and no business here, so
 * a mismatch is a redirect, not a partial render. A product owners.serves
 * turns away goes to the paused page.
 */
export async function requireAffiliate(): Promise<{
  affiliateId: string;
  email: string;
  merchant: { id: string; name: string; websiteUrl: string };
}> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "affiliate") redirect("/affiliates/login");

  const host = await requestHost();
  const merchant = await merchantOnHost(host);
  if (!merchant) redirect("/affiliates/login");

  const affiliate = await db.affiliate.findUnique({
    where: { id: session.user.id },
    select: { id: true, email: true, merchantId: true },
  });
  if (!affiliate || affiliate.merchantId !== merchant.id) redirect("/affiliates/login");

  return {
    affiliateId: affiliate.id,
    email: affiliate.email,
    merchant: { id: merchant.id, name: merchant.name, websiteUrl: merchant.websiteUrl },
  };
}
