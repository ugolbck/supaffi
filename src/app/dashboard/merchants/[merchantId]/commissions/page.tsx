import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PayoutsTab } from "./PayoutsTab";
import { FlaggedTab } from "./FlaggedTab";

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ merchantId: string }>;
  searchParams: Promise<{ payoutsPage?: string; flaggedPage?: string }>;
}) {
  const { merchantId } = await params;
  const { payoutsPage, flaggedPage } = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  return (
    <Tabs defaultValue="payouts" className="flex flex-1 flex-col gap-4">
      <TabsList>
        <TabsTrigger value="payouts">Payouts</TabsTrigger>
        <TabsTrigger value="flagged">Flagged</TabsTrigger>
      </TabsList>
      <TabsContent value="payouts">
        <PayoutsTab
          ownerId={session.user.id}
          merchantId={merchant.id}
          page={Number(payoutsPage) || 1}
        />
      </TabsContent>
      <TabsContent value="flagged">
        <FlaggedTab
          ownerId={session.user.id}
          merchantId={merchant.id}
          page={Number(flaggedPage) || 1}
        />
      </TabsContent>
    </Tabs>
  );
}
