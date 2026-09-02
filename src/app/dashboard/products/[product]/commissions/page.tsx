import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { CommissionTabs } from "./CommissionTabs";
import { PayoutsTab } from "./PayoutsTab";
import { FlaggedTab } from "./FlaggedTab";

function sanitizePage(raw: string | undefined): number {
  return Math.max(1, Math.floor(Number(raw)) || 1);
}

export default async function CommissionsPage({
  params,
  searchParams,
}: {
  params: Promise<{ product: string }>;
  searchParams: Promise<{ payoutsPage?: string; flaggedPage?: string; tab?: string }>;
}) {
  const { product } = await params;
  const { payoutsPage, flaggedPage, tab } = await searchParams;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const payoutsPageNum = sanitizePage(payoutsPage);
  const flaggedPageNum = sanitizePage(flaggedPage);
  const activeTab: "payouts" | "flagged" = tab === "flagged" ? "flagged" : "payouts";

  return (
    <CommissionTabs
      activeTab={activeTab}
      payoutsContent={
        <PayoutsTab
          ownerId={session.user.id}
          merchantId={merchant.id}
          page={payoutsPageNum}
          otherPage={flaggedPageNum}
        />
      }
      flaggedContent={
        <FlaggedTab
          ownerId={session.user.id}
          merchantId={merchant.id}
          page={flaggedPageNum}
          otherPage={payoutsPageNum}
        />
      }
    />
  );
}
