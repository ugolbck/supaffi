import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getProgramForMerchant } from "@/lib/program";
import { ProgramForm } from "../../new/ProgramForm";
import { updateProgramAction } from "./updateProgram";

export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ product: string; program: string }>;
}) {
  const { product, program: programSlug } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwnerBySlug(session.user.id, product);
  if (!merchant) notFound();

  const productRef = { id: merchant.id, slug: merchant.slug };

  const program = await getProgramForMerchant(session.user.id, merchant.id, programSlug);
  if (!program) notFound();

  const boundAction = updateProgramAction.bind(null, productRef, program.id);

  return (
    <div className="mx-auto w-full max-w-3xl">
      <ProgramForm
        action={boundAction}
        initial={{
          name: program.name,
          defaultCommissionRate: String(program.defaultCommissionRate),
          commissionDurationType: program.commissionDurationType,
          commissionDurationMonths: program.commissionDurationMonths?.toString() ?? "",
          attributionWindowDays: String(program.attributionWindowDays),
          holdingPeriodDays: String(program.holdingPeriodDays),
        }}
        submitLabel="Save changes"
      />
    </div>
  );
}
