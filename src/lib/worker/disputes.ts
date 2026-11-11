import { db } from "@/lib/db";

/**
 * What the payment provider says, right now, about the disputes on one payment.
 *
 * "unknown" means the disputes could not be read. It is treated like "open":
 * when Supaffi cannot tell whether a chargeback is still in progress, the
 * commission is not allowed to become payable.
 */
export type DisputeState = "clear" | "open" | "lost" | "unknown";

/**
 * Holds an unpaid commission while a dispute is open.
 *
 * A held commission is never PAYABLE, which is what keeps every payable screen,
 * total and badge right without each one knowing about disputes. So a PAYABLE
 * row goes back to PENDING, while a PENDING or FLAGGED one keeps its status.
 *
 * The order of the two writes matters. PENDING and FLAGGED rows are marked
 * first; if the sweep promotes an unmarked row in between, the second write
 * finds it PAYABLE and takes it back. Each write names the statuses it expects,
 * so a row being marked paid at the same moment ends up PAID and untouched: a
 * paid commission is final. The first date is kept on a repeated event.
 */
export async function holdForDispute(commissionId: string, now: Date = new Date()): Promise<void> {
  await db.commission.updateMany({
    where: { id: commissionId, status: { in: ["PENDING", "FLAGGED"] }, disputeOpenedAt: null },
    data: { disputeOpenedAt: now },
  });
  await db.commission.updateMany({
    where: { id: commissionId, status: "PAYABLE" },
    data: { status: "PENDING", disputeOpenedAt: now },
  });
}

/**
 * Lifts the hold once no dispute on the payment is open, the same way
 * dismissing a flag does: PAYABLE when the Holding Period is over, otherwise
 * PENDING for the sweep. A flagged row stays flagged.
 */
export async function releaseDisputeHold(commissionId: string, now: Date = new Date()): Promise<void> {
  await db.commission.updateMany({
    where: { id: commissionId, status: "PENDING", disputeOpenedAt: { not: null }, payableAt: { lte: now } },
    data: { status: "PAYABLE", disputeOpenedAt: null },
  });
  await db.commission.updateMany({
    where: { id: commissionId, status: { in: ["PENDING", "FLAGGED"] }, disputeOpenedAt: { not: null } },
    data: { disputeOpenedAt: null },
  });
}
