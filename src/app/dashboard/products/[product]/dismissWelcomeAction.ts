"use server";

import { revalidatePath } from "next/cache";
import { requireOwner } from "@/app/requireOwner";
import { dismissWelcome } from "@/lib/merchant";

export async function dismissWelcomeAction(product: { id: string; slug: string }): Promise<void> {
  await dismissWelcome(await requireOwner(), product.id);
  revalidatePath(`/dashboard/products/${product.slug}`);
}
