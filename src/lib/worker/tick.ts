import { isStripeError, loggableError } from "@/lib/stripeErrors";
import { claimBatch, markProcessed, markFailed } from "./claim";
import { sweepPayableCommissions } from "./sweep";
import { processWebhookEvent } from "./dispatch";
import { runDailyCleanup } from "./cleanup";

let ticking = false;

export async function runTick(): Promise<void> {
  // An overlapping wake-up (a NOTIFY firing mid-poll) is fine to drop —
  // rows stay PENDING until actually claimed, nothing is lost, the next
  // tick (interval or NOTIFY) picks it up. A row left PROCESSING by a crash
  // is picked up again once its claim lease runs out (see claim.ts).
  if (ticking) return;
  ticking = true;

  // Not awaited. A first cleanup on an old install can take a while and must
  // never hold up the queue; it returns at once when it ran less than a day
  // ago or is already going.
  runDailyCleanup().catch((err) => console.error("[worker] cleanup failed", err));
  try {
    const batch = await claimBatch();
    for (const event of batch) {
      try {
        await processWebhookEvent(event);
        await markProcessed(event.id);
      } catch (err) {
        // A Stripe error is logged by type and code only, since its message
        // names the masked key and the account. Anything else is a bug here
        // and keeps its stack.
        if (isStripeError(err)) {
          console.error(`[worker] event ${event.id} (${event.stripeEventId}) failed: ${loggableError(err)}`);
        } else {
          console.error(`[worker] event ${event.id} (${event.stripeEventId}) failed`, err);
        }
        await markFailed(event.id, event.attempts, err);
      }
    }
    await sweepPayableCommissions();
  } finally {
    ticking = false;
  }
}
