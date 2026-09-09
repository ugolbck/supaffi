"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { updateAffiliate } from "@/lib/affiliate";

/**
 * The two writes the affiliate sheet makes: which program someone is in, and
 * what they are paid. Both return nothing, so the sheet stays a form on a
 * server-rendered panel rather than a client screen holding state.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

export async function changeProgramAction(
  product: { id: string; slug: string },
  affiliateId: string,
  formData: FormData
): Promise<void> {
  const ownerId = await owner();
  const programId = String(formData.get("programId") ?? "").trim();
  // An empty id is refused by updateAffiliate, and the select always carries a
  // real one, so nothing is left to do here but ignore a submit that does not.
  if (programId === "") return;
  await updateAffiliate(ownerId, product.id, affiliateId, { programId });
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
}

export async function setCustomRateAction(
  product: { id: string; slug: string },
  affiliateId: string,
  formData: FormData
): Promise<void> {
  const ownerId = await owner();

  // "Use default" carries its own field. Reading an empty `rate` instead
  // would never fire: the button and the input share a form, and the value
  // already typed into the input is the one FormData hands back.
  if (formData.get("intent") === "default") {
    await updateAffiliate(ownerId, product.id, affiliateId, { customCommissionRate: null });
    revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
    return;
  }

  const raw = String(formData.get("rate") ?? "").trim();
  if (raw === "") return;
  const rate = Number(raw);
  if (!Number.isFinite(rate) || rate <= 0 || rate > 100) return;
  await updateAffiliate(ownerId, product.id, affiliateId, { customCommissionRate: rate });
  revalidatePath(`/dashboard/products/${product.slug}/affiliates`);
}
