import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { stripeClientFor } from "@/lib/stripe";
import { idOf, resolvePaymentReferenceId, reverseCommission } from "./chargeRefunded";

/**
 * A lost chargeback takes the whole sale back, so it takes the whole unpaid
 * commission back too, through the same path as a full refund. A commission
 * already paid is final and stays as it is.
 *
 * Only a closed dispute that was lost counts. `charge.dispute.funds_withdrawn`
 * fires when the dispute opens, and a Merchant who then wins it gets the money
 * reinstated; voiding at that point would mean un-voiding later, and a voided
 * commission never comes back. Waiting for the outcome costs nothing, since a
 * disputed commission is almost always still inside its Holding Period.
 */
export async function handleChargeDisputeClosed(merchant: Merchant, dispute: Stripe.Dispute): Promise<void> {
  if (dispute.status !== "lost") return;

  const stripe = stripeClientFor(merchant);
  let paymentIntentId = idOf(dispute.payment_intent);
  let legacyInvoice: string | { id: string } | null = null;
  if (!paymentIntentId) {
    // Older disputes can arrive without the PaymentIntent inline; the Charge
    // always has it, at the cost of one retrieve.
    const charge =
      typeof dispute.charge === "string" ? await stripe.charges.retrieve(dispute.charge) : dispute.charge;
    paymentIntentId = idOf(charge.payment_intent);
    legacyInvoice = (charge as unknown as { invoice?: string | { id: string } | null }).invoice ?? null;
  }

  const paymentRef = await resolvePaymentReferenceId(stripe, { legacyInvoice, paymentIntentId });
  if (!paymentRef) return;

  await reverseCommission(merchant, paymentRef, "chargeback", () => ({ void: true }));
}
