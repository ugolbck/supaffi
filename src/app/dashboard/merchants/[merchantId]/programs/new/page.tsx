import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwner } from "@/lib/merchant";
import { ProgramForm } from "./ProgramForm";
import { createProgramAction } from "./createProgram";

export default async function NewProgramPage({
  params,
}: {
  params: Promise<{ merchantId: string }>;
}) {
  const { merchantId } = await params;
  const session = await auth();
  if (!session?.user?.id) redirect("/login");

  const merchant = await getMerchantForOwner(session.user.id, merchantId);
  if (!merchant) notFound();

  const boundAction = createProgramAction.bind(null, merchantId);

  return (
    <main>
      <h1>New Program for {merchant.name}</h1>
      <ProgramForm action={boundAction} submitLabel="Create Program" />
    </main>
  );
}
