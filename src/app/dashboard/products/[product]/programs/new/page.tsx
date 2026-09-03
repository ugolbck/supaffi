import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getProductSetup, sectionGates, SECTION_UNLOCKED_BY } from "@/lib/productSetup";
import { SetupShell, SetupPanel } from "../../SetupShell";
import { ProgramForm } from "./ProgramForm";
import { createProgramAction } from "./createProgram";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ product: string }>;
}) {
  const { product } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const setup = await getProductSetup(session.user.id, merchant.id);
  if (!sectionGates(setup).programs) {
    redirect(`/dashboard/products/${merchant.slug}${SECTION_UNLOCKED_BY.programs}`);
  }

  const productRef = { id: merchant.id, slug: merchant.slug };

  const boundAction = createProgramAction.bind(null, productRef);

  return (
    <SetupShell
      step={2}
      title="Set your commission terms"
      lede="What affiliates earn, for how long, and how long a commission waits before you can pay it."
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
