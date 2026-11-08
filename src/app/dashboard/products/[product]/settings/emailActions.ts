"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import {
  clearMailFailure,
  connectMail,
  disconnectMail,
  mailErrorText,
  sendWith,
  setMailSwitch,
  smtpSettings,
  type MailSwitch,
} from "@/lib/mail";
import { testEmail } from "@/lib/emails";
import { db } from "@/lib/db";
import type { ProductRef } from "@/lib/merchant";

/**
 * The product's mail server: connecting it (which sends a test first), a test
 * on demand, turning it off, and what it sends. Each one checks the product
 * belongs to the signed-in Owner.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

const settingsPath = (product: ProductRef) => `/dashboard/products/${product.slug}/settings`;

export type MailFormState = { error: string; sentTo: string };

export async function connectMailAction(product: ProductRef, _prev: MailFormState, formData: FormData): Promise<MailFormState> {
  const result = await connectMail(
    await owner(),
    product.id,
    {
      host: String(formData.get("host") ?? ""),
      port: String(formData.get("port") ?? ""),
      user: String(formData.get("user") ?? ""),
      password: String(formData.get("password") ?? ""),
      from: String(formData.get("from") ?? ""),
    },
    (settings, to, name) => sendWith(settings, testEmail({ to, product: name }))
  );
  if ("error" in result) return { error: result.error, sentTo: "" };
  revalidatePath(settingsPath(product));
  return { error: "", sentTo: result.sentTo };
}

/** Sends a test through the saved settings, straight away rather than queued. */
export async function sendTestEmailAction(product: ProductRef): Promise<MailFormState> {
  const ownerId = await owner();
  const merchant = await db.merchant.findFirst({
    where: { id: product.id, ownerId },
    select: { name: true, owner: { select: { email: true } } },
  });
  const settings = merchant ? await smtpSettings(product.id) : null;
  if (!merchant || !settings) return { error: "Email is off", sentTo: "" };
  try {
    await sendWith(settings, testEmail({ to: merchant.owner.email, product: merchant.name }));
  } catch (err) {
    return { error: mailErrorText(err, settings), sentTo: "" };
  }
  await clearMailFailure(product.id);
  revalidatePath(settingsPath(product));
  return { error: "", sentTo: merchant.owner.email };
}

export async function disconnectMailAction(product: ProductRef): Promise<void> {
  await disconnectMail(await owner(), product.id);
  revalidatePath(settingsPath(product));
}

export async function setMailSwitchAction(product: ProductRef, name: MailSwitch, on: boolean): Promise<void> {
  await setMailSwitch(await owner(), product.id, name, on);
  revalidatePath(settingsPath(product));
}
