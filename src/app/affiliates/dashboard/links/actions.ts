"use server";

import { revalidatePath } from "next/cache";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { createLink, updateLink, deleteLink } from "@/lib/affiliateLink";

/**
 * The three writes the Links screen makes.
 *
 * The affiliate id comes from requireAffiliate, never from the form. A link id
 * does come from the client, and every lib call below is scoped by affiliate
 * id for exactly that reason: a link id belonging to somebody else matches no
 * row and comes back as "That link no longer exists."
 *
 * The path is revalidated as a layout, not a page: a link's code and counts
 * are on the Overview as well, so a rename that only refreshed this screen
 * would leave the old code sitting on the one the Affiliate goes back to.
 */

export async function createLinkAction(input: {
  code: string;
  destinationPath: string;
}): Promise<{ error: string } | { ok: true }> {
  const { affiliateId } = await requireAffiliate();
  const result = await createLink(affiliateId, input);
  if ("error" in result) return result;
  revalidatePath("/affiliates/dashboard", "layout");
  return { ok: true };
}

export async function updateLinkAction(
  linkId: string,
  input: { code: string; destinationPath: string }
): Promise<{ error: string } | { ok: true }> {
  const { affiliateId } = await requireAffiliate();
  const result = await updateLink(affiliateId, linkId, input);
  if ("error" in result) return result;
  revalidatePath("/affiliates/dashboard", "layout");
  return { ok: true };
}

export async function deleteLinkAction(
  linkId: string
): Promise<{ error: string } | { ok: true }> {
  const { affiliateId } = await requireAffiliate();
  const result = await deleteLink(affiliateId, linkId);
  if ("error" in result) return result;
  revalidatePath("/affiliates/dashboard", "layout");
  return { ok: true };
}
