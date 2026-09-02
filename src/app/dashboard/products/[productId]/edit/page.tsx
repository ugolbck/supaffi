import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { MerchantForm } from "../../new/MerchantForm";
import { updateMerchantAction } from "./updateMerchant";

export default async function EditMerchantPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId: merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const boundAction = updateMerchantAction.bind(null, merchantId);

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h1 className="font-heading text-2xl font-extrabold tracking-tight">{merchant.name}</h1>
        <p className="text-sm text-muted-foreground">
          Keys live under Integrations.
        </p>
      </div>

      <MerchantForm
        action={boundAction}
        initial={{ name: merchant.name, domain: merchant.domain, websiteUrl: merchant.websiteUrl }}
        submitLabel="Save changes"
      />
    </div>
  );
}
