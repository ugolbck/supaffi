import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { stripeClientFor } from "@/lib/stripe";
import { reverseCommission } from "./chargeRefunded";
import { disputedPayment, settleDisputeHold } from "../disputes";

/**
 * A lost chargeback takes the whole sale back, so it takes the whole unpaid
 * commission back too, through the same path as a full refund. A commission
 * already paid is final and stays as it is.
 *
 * Any other outcome, won or an inquiry closed without a chargeback, releases
 * the hold the dispute put on the commission, unless another dispute on the
 * same payment is still open. That check reads Stripe, see disputes.ts.
 *
 * `charge.dispute.funds_withdrawn` and `funds_reinstated` are not used: they
 * move the merchant's balance and follow the opening and closing events, which
 * already say everything the commission needs.
 */
export async function handleChargeDisputeClosed(merchant: Merchant, dispute: Stripe.Dispute): Promise<void> {
  if (dispute.status !== "lost") {
    await settleDisputeHold(merchant, dispute);
    return;
  }

  const stripe = stripeClientFor(merchant);
  const payment = await disputedPayment(stripe, dispute);
  if (!payment) return;

  await reverseCommission(merchant, payment.paymentRef, "chargeback", () => ({ void: true }));
}
