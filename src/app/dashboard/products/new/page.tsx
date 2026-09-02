import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { MerchantForm } from "./MerchantForm";
import { createMerchantAction } from "./createMerchant";

export default async function NewMerchantPage() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-5">
      {/* Carries the onboarding's step counter through to the page it sends
          you to, so this doesn't read as an unrelated settings form. */}
      <div className="flex flex-col gap-2">
        <p className="text-xs font-medium tracking-wide text-accent-700 uppercase">Step 1 of 4</p>
        <h1 className="font-heading text-2xl font-semibold tracking-tight">Add your product</h1>
        <p className="text-sm text-muted-foreground">Just the basics.</p>
      </div>

      <MerchantForm action={createMerchantAction} submitLabel="Add product" />
    </div>
  );
}
