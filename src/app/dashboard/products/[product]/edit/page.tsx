import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { MerchantForm } from "../../new/MerchantForm";
import { updateMerchantAction } from "./updateMerchant";

export default async function EditMerchantPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const productRef = { id: merchant.id, slug: merchant.slug };

  const boundAction = updateMerchantAction.bind(null, productRef);

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
