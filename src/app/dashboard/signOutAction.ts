"use server";

import { signOut } from "@/lib/auth";

export async function signOutAction(): Promise<void> {
  await signOut({ redirectTo: "/login" });
}
