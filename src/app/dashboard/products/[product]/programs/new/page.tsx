import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { SetupShell, SetupPanel } from "../../SetupShell";
import { ProgramForm } from "./ProgramForm";
import { createProgramAction } from "./createProgram";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ productId: string }>;
}) {
  const { productId: merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const boundAction = createProgramAction.bind(null, merchantId);

  return (
    <SetupShell
      step={2}
      title="Set your commission terms"
      lede="What affiliates earn, for how long, and how long a commission waits before you can pay it."
      merchantId={merchantId}
      // The form's own submit is what moves this step forward, so the footer
      // offers no second, competing way to advance.
      next={null}
    >
      <SetupPanel className="lg:flex-1 lg:overflow-y-auto">
        <ProgramForm action={boundAction} submitLabel="Create Program" />
      </SetupPanel>
    </SetupShell>
  );
}
