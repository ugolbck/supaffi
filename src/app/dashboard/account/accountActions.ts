"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { changeOwnerEmail, changeOwnerPassword } from "@/lib/owner";
import {
  connectMail,
  disconnectMail,
  mailErrorText,
  ownerMail,
  sendWith,
  setMailSwitch,
  smtpSettings,
  type MailSwitch,
} from "@/lib/mail";
import { testEmail } from "@/lib/emails";

/**
 * What an owner can change about their own account: email, password, and the
 * mail server their notifications go out through.
 *
 * Neither refreshes the session. The email claim in the current token is
 * written at login and stays stale until the next one, and a password change
 * deliberately ends every session issued before it, so both forms say what
 * happens next rather than pretending the change is invisible.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

export async function changeEmailAction(
  _prev: { error: string; done: boolean },
  formData: FormData
): Promise<{ error: string; done: boolean }> {
  const result = await changeOwnerEmail(
    await owner(),
    String(formData.get("password") ?? ""),
    String(formData.get("email") ?? "")
  );
  return result ? { error: result.error, done: false } : { error: "", done: true };
}

export async function changePasswordAction(
  _prev: { error: string; done: boolean },
  formData: FormData
): Promise<{ error: string; done: boolean }> {
  const result = await changeOwnerPassword(
    await owner(),
    String(formData.get("current") ?? ""),
    String(formData.get("next") ?? "")
  );
  return result ? { error: result.error, done: false } : { error: "", done: true };
}

export type MailFormState = { error: string; sentTo: string };

export async function connectMailAction(_prev: MailFormState, formData: FormData): Promise<MailFormState> {
  const ownerId = await owner();
  const result = await connectMail(
    ownerId,
    {
      host: String(formData.get("host") ?? ""),
      port: String(formData.get("port") ?? ""),
      user: String(formData.get("user") ?? ""),
      password: String(formData.get("password") ?? ""),
      from: String(formData.get("from") ?? ""),
    },
    (settings, to) => sendWith(settings, testEmail({ to }))
  );
  if ("error" in result) return { error: result.error, sentTo: "" };
  revalidatePath("/dashboard/account");
  return { error: "", sentTo: result.sentTo };
}

/** Sends a test through the saved settings, straight away rather than queued. */
export async function sendTestEmailAction(): Promise<MailFormState> {
  const ownerId = await owner();
  const settings = await smtpSettings(ownerId);
  const to = (await ownerMail(ownerId))?.ownerEmail;
  if (!settings || !to) return { error: "Email is off", sentTo: "" };
  try {
    await sendWith(settings, testEmail({ to }));
  } catch (err) {
    return { error: mailErrorText(err, settings), sentTo: "" };
  }
  return { error: "", sentTo: to };
}

export async function disconnectMailAction(): Promise<void> {
  await disconnectMail(await owner());
  revalidatePath("/dashboard/account");
}

export async function setMailSwitchAction(name: MailSwitch, on: boolean): Promise<void> {
  if (!["notifyNewAffiliates", "notifyNewSales", "emailAffiliates"].includes(name)) return;
  await setMailSwitch(await owner(), name, on);
  revalidatePath("/dashboard/account");
}
