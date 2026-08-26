import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getAffiliateSession } from "@/lib/affiliate";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyLinkButton } from "./CopyLinkButton";

export default async function AffiliateDashboardPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "affiliate") {
    redirect("/affiliates/login");
  }

  const data = await getAffiliateSession(session.user.id);
  if (!data) redirect("/affiliates/login");

  const referralLink = `${data.merchantWebsiteUrl}?ref=${data.referralCode}`;

  return (
    <main className="mx-auto flex max-w-2xl flex-col justify-center px-4 py-16">
      <Card>
        <CardHeader>
          <CardTitle>Your referral link</CardTitle>
          <CardDescription>Share this link to start earning commission.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="rounded-(--radius-structural) border border-border bg-muted px-3 py-2 font-mono text-sm break-all">
            {referralLink}
          </div>
          <CopyLinkButton link={referralLink} />
          <div className="flex gap-6 text-sm text-muted-foreground">
            <span>0 clicks</span>
            <span>0 commissions</span>
          </div>
        </CardContent>
      </Card>
    </main>
  );
}
