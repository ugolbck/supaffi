"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { dismissWelcome } from "@/lib/merchant";

export async function dismissWelcomeAction(product: { id: string; slug: string }): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  await dismissWelcome(session.user.id, product.id);
  revalidatePath(`/dashboard/products/${product.slug}`);
}
