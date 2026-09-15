import type { Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";
import { stripeClientFor } from "@/lib/stripe";
import {
  findCommissionForPayment,
  idOf,
  resolvePaymentReferenceIds,
  reverseCommission,
} from "./handlers/chargeRefunded";

/**
 * What Stripe says, right now, about the disputes on one payment.
 *
 * "unknown" means the disputes could not be read. It is treated like "open":
 * when Supaffi cannot tell whether a chargeback is still in progress, the
 * commission is not allowed to become payable.
 */
export type DisputeState = "clear" | "open" | "lost" | "unknown";

// The closed outcomes that leave the merchant with the money. Anything else,
// including a status a newer API version adds, still counts as in progress.
// "prevented" is decided separately below, since it hides two outcomes.
const SETTLED_FOR_MERCHANT: readonly string[] = ["won", "warning_closed"];

/** What matters from a dispute, wherever it came from: Stripe's list, or an event. */
type DisputeLike = { status: string; payment_method_details?: { card?: { case_type?: string } } };

/**
 * Whether a "prevented" dispute left the merchant with the money.
 *
 * Stripe Dispute Prevention resolves a dispute as "prevented" for two
 * different reasons, told apart only by `payment_method_details.card.case_type`.
 * A "block" leaves the charge as it was: the merchant keeps the money. A
 * "resolution" refunds the cardholder before it becomes a chargeback, so it
 * cost the merchant the sale just as a lost dispute would. A missing or
 * unrecognised case type is read the same as a resolution, since Supaffi
 * cannot then tell a block happened.
 */
function preventedKeptTheMoney(dispute: DisputeLike): boolean {
  return dispute.payment_method_details?.card?.case_type === "block";
}

/** One answer for every dispute on a charge. A single lost one decides it. */
export function disputeStateOf(disputes: DisputeLike[]): "clear" | "open" | "lost" {
  if (disputes.some((dispute) => dispute.status === "lost" || (dispute.status === "prevented" && !preventedKeptTheMoney(dispute)))) {
    return "lost";
  }
  if (
    disputes.some(
      (dispute) => !SETTLED_FOR_MERCHANT.includes(dispute.status) && !(dispute.status === "prevented" && preventedKeptTheMoney(dispute))
    )
  ) {
    return "open";
  }
  return "clear";
}

/**
 * Lists the disputes on a payment and reduces them to one state.
 *
 * Read from Stripe rather than taken from the event, because Stripe does not
 * guarantee order: an opening event can arrive after the dispute closed, and a
 * charge can carry more than one dispute over time. The list is the only view
 * that is right in every order.
 *
 * `trigger` is the dispute the caller's own event is about. Stripe's list can
 * briefly lag behind the event that reports it, most often right after the
 * dispute opens; when the trigger is missing from what came back, it is added
 * before reducing, so a handler never reads "clear" for a dispute it was just
 * told about.
 *
 * `emptyMeansUnknown` is for the creation path only (paymentState.ts), which
 * has no event and so no trigger to fall back on. It is only ever asked for
 * when the charge itself says it was disputed, and a disputed charge always
 * has at least one dispute, so an empty list there is never really "clear":
 * it is the opening event that arrived first, found no commission yet and was
 * dropped, with nothing later to add the hold. Reading that as "unknown"
 * holds the new row instead of creating it unheld.
 *
 * Never throws. A key without Disputes read, or a Stripe outage, answers
 * "unknown", which holds the commission; the log line says how to fix it.
 */
export async function disputeStateFor(
  stripe: Stripe,
  paymentIntentId: string,
  trigger?: Stripe.Dispute,
  emptyMeansUnknown = false
): Promise<DisputeState> {
  try {
    const page = await stripe.disputes.list({ payment_intent: paymentIntentId, limit: 100 });
    const disputes =
      trigger && !page.data.some((d) => d.id === trigger.id)
        ? [...page.data, { status: trigger.status, payment_method_details: trigger.payment_method_details }]
        : page.data;
    if (emptyMeansUnknown && disputes.length === 0) return "unknown";
    return disputeStateOf(disputes);
  } catch (err) {
    console.warn(
      `[worker] could not read the disputes on payment ${paymentIntentId}: ${(err as Error).message}. Its commission is held until they can be read; replacing the Stripe key in settings lets Supaffi read disputes.`
    );
    return "unknown";
  }
}

/**
 * The references a disputed payment's commission can be stored under, in the
 * order to try them, and the PaymentIntent the disputes are listed by. Null
 * when the dispute traces to nothing Supaffi tracks.
 */
export async function disputedPayment(
  stripe: Stripe,
  dispute: Stripe.Dispute
): Promise<{ paymentRefs: string[]; paymentIntentId: string | null } | null> {
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

  const paymentRefs = await resolvePaymentReferenceIds(stripe, { legacyInvoice, paymentIntentId });
  return paymentRefs.length > 0 ? { paymentRefs, paymentIntentId } : null;
}

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

/**
 * Brings a commission in line with the disputes on its payment: held while one
 * is open or cannot be read, voided as a chargeback once one is lost, released
 * when every one closed in the merchant's favour.
 *
 * A paid or voided commission is left alone before anything is read. A dispute
 * that opens after payout changes nothing; if it is later lost, the closing
 * event logs it through the refund path.
 *
 * A commission not recorded yet is left to its creation, which reads the same
 * disputes (paymentState.ts).
 */
export async function settleDisputeHold(merchant: Merchant, dispute: Stripe.Dispute): Promise<void> {
  const stripe = stripeClientFor(merchant);
  const payment = await disputedPayment(stripe, dispute);
  if (!payment) return;

  const commission = await findCommissionForPayment(merchant, payment.paymentRefs);
  if (!commission) return;
  if (commission.status === "PAID" || commission.status === "VOIDED") return;

  let state: DisputeState = "unknown";
  if (payment.paymentIntentId) {
    state = await disputeStateFor(stripe, payment.paymentIntentId, dispute);
  } else {
    console.warn(
      `[worker] dispute ${dispute.id} has no payment to list disputes by, so commission ${commission.id} is held.`
    );
  }

  if (state === "lost") {
    await reverseCommission(merchant, payment.paymentRefs, "chargeback", () => ({ void: true }));
    return;
  }
  if (state === "clear") {
    await releaseDisputeHold(commission.id);
    return;
  }
  await holdForDispute(commission.id);
}
