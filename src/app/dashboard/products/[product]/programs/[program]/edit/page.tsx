import { redirect, notFound } from "next/navigation";
import { auth } from "@/lib/auth";
import { getMerchantForOwnerBySlug } from "@/lib/merchant";
import { getProgramForMerchant } from "@/lib/program";

/**
 * Editing is a sheet on the list now. The sheet is selected by id, so this
 * route's job is turning the slug an old link carries into that id.
 */
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

  const program = await getProgramForMerchant(session.user.id, merchant.id, programSlug);
  if (!program) notFound();

  redirect(`/dashboard/products/${merchant.slug}/programs?edit=${program.id}`);
}
