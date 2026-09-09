"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import {
  markCommissionsPaid,
  confirmCommissionFraud,
  dismissCommissionFlag,
  voidCommission,
} from "@/lib/commission";

/**
 * The four writes the ledger makes, all of them from a form on a
 * server-rendered panel: the sheet holds no copy of a commission, so every
 * action ends by landing back on the list and letting it draw itself again.
 *
 * "Back" is the list the Owner was looking at, tab and filters and page
 * included, so a payout does not quietly drop them onto the unfiltered ledger.
 * The page builds that URL and binds it to the form, and it is checked here
 * before the redirect: a bound argument is a value the browser posts, so it is
 * not trusted to be a URL on this list at all.
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
  if (error.includes("no longer payable")) return "partial";
  if (error.includes("one currency")) return "mixed";
  if (error.includes("refund adjustment")) return "clawback";
  if (error.includes("carries to the next payout")) return "negative";
  return "refused";
}

// `markCommissionsPaid` refuses rather than throws, so its reason travels back
// in the URL. Without it a payout the ledger declined would look like a button
// that did nothing.
function back(product: { slug: string }, listHref: string, error?: string): never {
  const list = `/dashboard/products/${product.slug}/commissions`;
  const target = listHref.startsWith(list) ? listHref : list;
  const query = error ? `${target.includes("?") ? "&" : "?"}error=${error}` : "";
  revalidatePath("/dashboard", "layout");
  redirect(`${target}${query}`);
}

export async function markPaidAction(
  listHref: string,
  product: { id: string; slug: string },
  ids: string[]
): Promise<void> {
  const result = await markCommissionsPaid(await owner(), product.id, ids);
  back(product, listHref, "error" in result ? refusalCode(result.error) : undefined);
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
