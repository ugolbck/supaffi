"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { markCommissionsPaid, type ShownCommission, STALE_PAGE } from "@/lib/commission";

function refusalCode(error: string): string {
  if (error.includes("Nothing selected")) return "empty";
  if (error.includes("one currency")) return "mixed";
  if (error === STALE_PAGE) return "stale";
  return "refused";
}

/**
 * One payout: the commissions on the row as shown, at the amounts shown, and
 * when the page was drawn. The ledger records those amounts; see
 * `markCommissionsPaid`. Its refusal, or how many rows it skipped or found already paid, comes back
 * in the URL as a code.
 */
export async function markPayoutPaidAction(
  product: { id: string; slug: string },
  shown: ShownCommission[],
  renderedAt: string
): Promise<void> {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "owner") redirect("/login");
  const result = await markCommissionsPaid(session.user.id, product.id, shown, renderedAt);

  const params = new URLSearchParams();
  if ("error" in result) params.set("error", refusalCode(result.error));
  else {
    if (result.skipped) params.set("skipped", String(result.skipped));
    if (result.alreadyPaid) {
      params.set("already", String(result.alreadyPaid.count));
      if (result.alreadyPaid.paidAt) params.set("paidOn", String(result.alreadyPaid.paidAt.getTime()));
      if (result.count > 0) params.set("recorded", "1");
    }
  }
  const search = params.toString();
  revalidatePath("/dashboard", "layout");
  redirect(`/dashboard/products/${product.slug}/payouts${search ? `?${search}` : ""}`);
}
