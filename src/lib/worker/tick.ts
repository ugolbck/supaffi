import { claimBatch, markProcessed, markFailed } from "./claim";
import { sweepPayableCommissions } from "./sweep";
import { processWebhookEvent } from "./dispatch";

let ticking = false;

export async function runTick(): Promise<void> {
  // An overlapping wake-up (a NOTIFY firing mid-poll) is fine to drop —
  // rows stay PENDING until actually claimed, nothing is lost, the next
  // tick (interval or NOTIFY) picks it up. A row left PROCESSING by a crash
  // is picked up again once its claim lease runs out (see claim.ts).
  if (ticking) return;
  ticking = true;
  try {
    const batch = await claimBatch();
    for (const event of batch) {
      try {
        await processWebhookEvent(event);
        await markProcessed(event.id);
      } catch (err) {
        console.error(`[worker] event ${event.id} (${event.stripeEventId}) failed`, err);
        await markFailed(event.id, event.attempts, err);
      }
    }
    await sweepPayableCommissions();
  } finally {
    ticking = false;
  }
}
