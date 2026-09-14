"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { safeListHref } from "@/lib/commissionRedirect";
import {
  markCommissionsPaid,
  confirmCommissionFraud,
  dismissCommissionFlag,
  voidCommission,
  type ShownCommission,
} from "@/lib/commission";

/**
 * The four writes the ledger makes, all of them from a form on a
 * server-rendered panel: the sheet holds no copy of a commission, so every
 * action ends by landing back on the list and letting it draw itself again.
 *
 * "Back" is the list the Owner was looking at, tab and filters and page
 * included, so a payout does not quietly drop them onto the unfiltered ledger.
 * The page builds that URL and binds it to the form, and `safeListHref` checks
 * it before the redirect: a bound argument is a value the browser posts, so it
 * is not trusted to be a URL on this list at all.
 */

async function owner(): Promise<string> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  return session.user.id;
}

/**
 * The closed set of refusals the ledger can hand back. The reason travels in
 * the URL as a code rather than a sentence, so nothing a form posts can put
 * text on the page; the list turns a code back into its fixed sentence and
 * ignores anything it does not know.
 */
function refusalCode(error: string): string {
  if (error.includes("Nothing selected")) return "empty";
  if (error.includes("one currency")) return "mixed";
  return "refused";
}

// `markCommissionsPaid` refuses rather than throws, so its reason travels back
// in the URL, and so does how many shown rows it skipped. Without them a
// payout the ledger declined or shortened would look like a button that did
// nothing, or did everything.
function back(
  product: { slug: string },
  listHref: string,
  outcome?: { error?: string; skipped?: number }
): never {
  const list = `/dashboard/products/${product.slug}/commissions`;
  const target = safeListHref(listHref, list);
  const params = new URLSearchParams();
  if (outcome?.error) params.set("error", outcome.error);
  if (outcome?.skipped) params.set("skipped", String(outcome.skipped));
  const search = params.toString();
  const query = search ? `${target.includes("?") ? "&" : "?"}${search}` : "";
  revalidatePath("/dashboard", "layout");
  redirect(`${target}${query}`);
}

/**
 * `shown` is every commission the Owner was looking at when they pressed the
 * button, each with the amount on screen, and `renderedAt` is when that page
 * was drawn. The ledger records those amounts; see `markCommissionsPaid`.
 */
export async function markPaidAction(
  listHref: string,
  product: { id: string; slug: string },
  shown: ShownCommission[],
  renderedAt: string
): Promise<void> {
  const result = await markCommissionsPaid(await owner(), product.id, shown, renderedAt);
  back(product, listHref, "error" in result ? { error: refusalCode(result.error) } : { skipped: result.skipped });
}

export async function confirmFraudAction(
  listHref: string,
  product: { id: string; slug: string },
  id: string
): Promise<void> {
  await confirmCommissionFraud(await owner(), product.id, id);
  back(product, listHref);
}

export async function dismissFlagAction(
  listHref: string,
  product: { id: string; slug: string },
  id: string
): Promise<void> {
  await dismissCommissionFlag(await owner(), product.id, id);
  back(product, listHref);
}

export async function voidAction(
  listHref: string,
  product: { id: string; slug: string },
  id: string,
  formData: FormData
): Promise<void> {
  // Capped: the reason is read back months later in a table cell, and the
  // field is a free text input on a page anybody with the session can post to.
  const reason = String(formData.get("reason") ?? "").trim().slice(0, 200) || "voided by owner";
  await voidCommission(await owner(), product.id, id, reason);
  back(product, listHref);
}
