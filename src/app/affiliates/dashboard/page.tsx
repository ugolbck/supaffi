import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAffiliateSession, getAffiliateStats, getAffiliatePayoutDetails } from "@/lib/affiliate";
import { getMerchantByDomain } from "@/lib/merchant";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "@/components/CopyLinkButton";
import { StatsRow } from "./StatsRow";
import { CommissionHistory } from "./CommissionHistory";
import { PayoutDetailsForm } from "./PayoutDetailsForm";

function sanitizePage(raw: string | undefined): number {
  const n = Math.floor(Number(raw));
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, 1_000_000);
}

export default async function AffiliateDashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "affiliate") {
    redirect("/affiliates/login");
  }

  const data = await getAffiliateSession(session.user.id);
  if (!data) redirect("/affiliates/login");

  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant || merchant.id !== data.merchantId) {
    redirect("/affiliates/login");
  }

  const { page: pageParam } = await searchParams;
  const page = sanitizePage(pageParam);

  const referralLink = `${data.merchantWebsiteUrl}?ref=${data.referralCode}`;
  const [stats, payoutDetails] = await Promise.all([
    getAffiliateStats(session.user.id),
    getAffiliatePayoutDetails(session.user.id),
  ]);

  return (
    <main className="mx-auto flex h-svh w-full max-w-2xl flex-col overflow-hidden px-4">
      <div className="flex flex-1 flex-col gap-6 overflow-y-auto py-8">
        <Card>
          <CardHeader>
            <CardTitle>Your referral link</CardTitle>
            <CardDescription>Share this link to start earning commission.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="w-fit rounded-md border border-border/70 bg-muted px-2.5 py-1 font-mono text-sm break-all">
              {referralLink}
            </div>
            <CopyLinkButton link={referralLink} />
          </CardContent>
        </Card>

        <StatsRow stats={stats} />

        <div className="flex flex-col gap-2">
          <h2 className="font-heading text-lg font-semibold tracking-tight">Commission history</h2>
          <CommissionHistory affiliateId={session.user.id} page={page} />
        </div>

        <PayoutDetailsForm initial={payoutDetails ?? ""} />
      </div>
    </main>
  );
}
