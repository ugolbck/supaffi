"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  markCommissionsPaid,
  confirmCommissionFraud,
  dismissCommissionFlag,
  voidCommission,
} from "@/lib/commission";

/**
 * The four writes the ledger makes, all of them from a form on a
 * server-rendered panel: the sheet holds no copy of a commission, so every
 * action ends by landing back on the list and letting it draw itself again.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

// `markCommissionsPaid` refuses rather than throws, so its reason travels back
// in the URL. Without it a payout the ledger declined would look like a button
// that did nothing.
function back(product: { slug: string }, error?: string): never {
  revalidatePath("/dashboard", "layout");
  redirect(
    `/dashboard/products/${product.slug}/commissions${error ? `?error=${encodeURIComponent(error)}` : ""}`
  );
}

export async function markPaidAction(
  product: { id: string; slug: string },
  ids: string[]
): Promise<void> {
  const result = await markCommissionsPaid(await owner(), product.id, ids);
  back(product, "error" in result ? result.error : undefined);
}

export async function confirmFraudAction(
  product: { id: string; slug: string },
  id: string
): Promise<void> {
  await confirmCommissionFraud(await owner(), product.id, id);
  back(product);
}

export async function dismissFlagAction(
  product: { id: string; slug: string },
  id: string
): Promise<void> {
  await dismissCommissionFlag(await owner(), product.id, id);
  back(product);
}

export async function voidAction(
  product: { id: string; slug: string },
  id: string,
  formData: FormData
): Promise<void> {
  // Capped: the reason is read back months later in a table cell, and the
  // field is a free text input on a page anybody with the session can post to.
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || "voided by owner";
  await voidCommission(await owner(), product.id, id, reason);
  back(product);
}
