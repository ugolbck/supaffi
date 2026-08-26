import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { MerchantForm } from "../../new/MerchantForm";
import { updateMerchantAction } from "./updateMerchant";

export default async function EditMerchantPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const boundAction = updateMerchantAction.bind(null, merchantId);

  return (
    <main>
      <h1>Edit {merchant.name}</h1>
      <MerchantForm
        action={boundAction}
        initial={{ name: merchant.name, domain: merchant.domain, websiteUrl: merchant.websiteUrl }}
        credentialsRequired={false}
      />
    </main>
  );
}
