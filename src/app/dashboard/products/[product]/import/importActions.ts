"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/app/requireOwner";
import { confirmImport, discardImport, startImport } from "@/lib/import/jobs";
import { isImportSource } from "@/lib/import/types";
import { inviteAffiliatesWithoutPassword } from "@/lib/notify";

type Product = { id: string; slug: string };

const page = (product: Product, search = "") => `/dashboard/products/${product.slug}/import${search}`;

export async function startImportAction(product: Product, _prev: { error: string }, formData: FormData): Promise<{ error: string }> {
  const ownerId = await requireOwner();
  const source = formData.get("source");
  if (!isImportSource(source)) return { error: "Pick the tool you are moving from." };
  const result = await startImport(
    ownerId,
    product.id,
    source,
    String(formData.get("apiKey") ?? ""),
    formData.has("accountId") ? String(formData.get("accountId")) : null
  );
  if (result.error !== null) return { error: result.error };
  redirect(page(product));
}

/** The Owner's go, with the program picked for each campaign (`program:<campaign id>` fields). */
export async function confirmImportAction(product: Product, importId: string, formData: FormData): Promise<void> {
  const ownerId = await requireOwner();
  const mapping: Record<string, string> = {};
  for (const [name, value] of formData.entries()) {
    if (name.startsWith("program:") && typeof value === "string") mapping[name.slice("program:".length)] = value;
  }
  await confirmImport(ownerId, product.id, importId, mapping);
  redirect(page(product));
}

export async function discardImportAction(product: Product, importId: string): Promise<void> {
  await discardImport(await requireOwner(), product.id, importId);
  redirect(page(product));
}

export async function inviteAction(product: Product): Promise<void> {
  const invited = await inviteAffiliatesWithoutPassword(await requireOwner(), product.id);
  revalidatePath("/dashboard", "layout");
  redirect(page(product, invited === null ? "?invited=off" : `?invited=${invited}`));
}
