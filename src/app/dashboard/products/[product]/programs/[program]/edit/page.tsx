import { redirect, notFound } from "next/navigation";
import { requireOwner } from "@/app/requireOwner";
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
  const ownerId = await requireOwner();

  const merchant = await getMerchantForOwnerBySlug(ownerId, product);
  if (!merchant) notFound();

  const program = await getProgramForMerchant(ownerId, merchant.id, programSlug);
  if (!program) notFound();

  redirect(`/dashboard/products/${merchant.slug}/programs?edit=${program.id}`);
}
