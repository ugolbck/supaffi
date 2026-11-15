import { cache } from "react";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { ext } from "@/extensions";

// The one Owner check. Every Owner page, server action and Owner-only API
// route starts with requireOwner(), never with its own session test: a layout
// does not guard the actions or the page work under it, so the check has to
// sit in each of them. test/app/requireOwner.test.ts refuses a file that
// skips it.

/**
 * The signed-in Owner, without the access check. Only for what stays open to
 * an Owner refused by owners.canUse: the layouts, the account page and its
 * actions.
 */
export const requireOwnerSession = cache(async (): Promise<{ ownerId: string; email: string }> => {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return { ownerId: session.user.id, email: session.user.email ?? "" };
});

/**
 * The signed-in Owner's id, once owners.canUse lets them in. A refused Owner
 * goes where dashboard.gate sends them, or gets not found when it sends
 * nowhere, so nothing after this call runs.
 */
export const requireOwner = cache(async (): Promise<string> => {
  const { ownerId } = await requireOwnerSession();
  if (await ext.owners.canUse(ownerId)) return ownerId;
  const gate = await ext.dashboard.gate(ownerId);
  if (gate.redirect) redirect(gate.redirect);
  notFound();
});
