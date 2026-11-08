import { isStripeError, loggableError } from "@/lib/stripeErrors";
import { claimBatch, markProcessed, markFailed } from "./claim";
import { sweepPayableCommissions } from "./sweep";
import { processWebhookEvent } from "./dispatch";
import { runDailyCleanup } from "./cleanup";
import { sendDueEmails } from "./sendEmails";

let ticking = false;
let wokenWhileTicking = false;

export async function runTick(): Promise<void> {
  // An overlapping wake-up (a NOTIFY firing mid-poll) does not start a second
  // tick. It is remembered instead, and the tick runs once more when this one
  // ends: an event that arrived while emails were going out is handled then,
  // not five seconds later at the next poll. A row left PROCESSING by a crash
  // is picked up again once its claim lease runs out (see claim.ts).
  if (ticking) {
    wokenWhileTicking = true;
    return;
  }
  ticking = true;
  wokenWhileTicking = false;

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
    // After the events, so the emails a batch queued go out on the same tick.
    // Its own catch: a mail server that is down must not hold up the queue.
    await sendDueEmails().catch((err) => console.error("[worker] sending email failed", err));
  } finally {
    ticking = false;
  }
  if (wokenWhileTicking) await runTick();
}
