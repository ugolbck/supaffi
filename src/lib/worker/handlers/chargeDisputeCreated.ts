import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { settleDisputeHold } from "../disputes";

/**
 * A chargeback usually closes weeks after it opens, often after the Holding
 * Period, so the commission is held from the moment the dispute opens rather
 * than paid and then lost. The hold, and what a late or repeated event means
 * for it, is decided in disputes.ts.
 */
export async function handleChargeDisputeCreated(merchant: Merchant, dispute: Stripe.Dispute): Promise<void> {
  await settleDisputeHold(merchant, dispute);
}
