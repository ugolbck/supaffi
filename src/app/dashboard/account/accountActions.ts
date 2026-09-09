"use server";

import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { changeOwnerEmail, changeOwnerPassword } from "@/lib/owner";

/**
 * The two things an owner can change about their own account.
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
