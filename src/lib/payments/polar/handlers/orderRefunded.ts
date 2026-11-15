import type { Merchant } from "@prisma/client";
import { db } from "@/lib/db";
import { findCommissionForPayment, prorateCommission, reverseCommission } from "@/lib/worker/reversal";
import type { PolarOrder } from "@/lib/payments/polar/types";

/**
 * A refund, partial or full, including one Polar makes on its own to head off
 * a chargeback. The order's refunded amount is cumulative and, like its net
 * amount, before tax, so the commission keeps the share still paid.
 *
 * The order.paid that writes the commission carries the order as it was when
 * paid, with nothing refunded, and the token cannot read the order again. So a
 * refund that reaches the worker while that sale is still waiting in the
 * queue, after a failed attempt for instance, is retried until the sale has
 * been processed, rather than finding no commission and being lost.
 */
export async function handleOrderRefunded(merchant: Merchant, order: PolarOrder): Promise<void> {
  if (!(await findCommissionForPayment(merchant, [order.id]))) {
    const saleQueued = await db.webhookEvent.findFirst({
      where: {
        merchantId: merchant.id,
        status: { in: ["PENDING", "PROCESSING"] },
        AND: [{ payload: { path: ["type"], equals: "order.paid" } }, { payload: { path: ["data", "id"], equals: order.id } }],
      },
      select: { id: true },
    });
    if (saleQueued) {
      throw new Error(`[worker] order ${order.id} was refunded before its sale was processed, so the refund is retried after it`);
    }
    return;
  }
  await reverseCommission(merchant, [order.id], "refund", (commission) =>
    prorateCommission({
      gross: commission.grossAmount ?? commission.amount,
      chargeTotal: order.net_amount,
      refunded: order.refunded_amount,
    })
  );
}
