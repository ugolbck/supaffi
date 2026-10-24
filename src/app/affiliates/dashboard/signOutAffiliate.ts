"use server";

import { signOut } from "@/lib/auth";

export async function signOutAffiliate(): Promise<void> {
  await signOut({ redirectTo: "/affiliates/login" });
}
