import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { getProgramForMerchant } from "@/lib/program";
import { ProgramForm } from "../../new/ProgramForm";
import { updateProgramAction } from "./updateProgram";

export default async function EditProgramPage({
  params,
}: {
  params: Promise<{ merchantId: string; programId: string }>;
}) {
  const { merchantId, programId } = await params;
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const program = await getProgramForMerchant(session.user.id, merchantId, programId);
  if (!program) notFound();

  const boundAction = updateProgramAction.bind(null, merchantId, programId);

  return (
    <main>
      <h1>Edit {program.name}</h1>
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
    </main>
  );
}
