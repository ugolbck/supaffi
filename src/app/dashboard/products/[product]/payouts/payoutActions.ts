"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOwner } from "@/app/requireOwner";
import { markPayoutsPaid, type ShownCommission, STALE_PAGE } from "@/lib/commission";

function refusalCode(error: string): string {
  if (error.includes("Nothing selected")) return "empty";
  if (error.includes("one currency")) return "mixed";
  if (error === STALE_PAGE) return "stale";
  return "refused";
}

/** The view the press came from, kept so the page comes back to it. Anything else is dropped. */
function viewParams(view: { tab?: unknown; currency?: unknown; method?: unknown }): URLSearchParams {
  const params = new URLSearchParams();
  if (view.tab === "below") params.set("tab", "below");
  if (typeof view.currency === "string" && /^[a-z]{3}$/.test(view.currency)) params.set("currency", view.currency);
  if (typeof view.method === "string" && /^[a-z]{2,10}$/.test(view.method)) params.set("method", view.method);
  return params;
}

/**
 * The payouts the Owner ticked, each the commissions on its row as shown, at
 * the amounts shown, and when the page was drawn, with the reference and note
 * typed in the dialog. The ledger records each; see `markPayoutsPaid`. How
 * many it recorded, skipped or found already paid, and its first refusal, come
 * back in the URL as codes.
 */
export async function markPayoutsPaidAction(
  product: { id: string; slug: string },
  view: { tab: string; currency: string | null; method: string | null },
  batch: ShownCommission[][],
  renderedAt: string,
  formData: FormData
): Promise<void> {
  const result = await markPayoutsPaid(await requireOwner(), product.id, batch, renderedAt, {
    reference: formData.get("reference") as string | null,
    note: formData.get("note") as string | null,
  });

  const params = viewParams(view ?? {});
  if (result.error) params.set("error", refusalCode(result.error));
  if (result.payouts) params.set("paid", String(result.payouts));
  if (result.skipped) params.set("skipped", String(result.skipped));
  if (result.alreadyPaid) {
    params.set("already", String(result.alreadyPaid));
    if (result.alreadyPaidAt) params.set("paidOn", String(result.alreadyPaidAt.getTime()));
    if (result.payouts) params.set("recorded", "1");
  }
  const search = params.toString();
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/payouts${search ? `?${search}` : ""}`);
}
