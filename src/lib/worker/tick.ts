import { providerErrorLabel } from "@/lib/payments";
import { claimBatch, markProcessed, markFailed } from "./claim";
import { sweepPayableCommissions } from "./sweep";
import { processWebhookEvent } from "./dispatch";
import { runDailyCleanup } from "./cleanup";
import { runEmailSender } from "./sendEmails";

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
        // A provider's error is logged by its label only, since its message
        // can name the masked key and the account. Anything else is a bug
        // here and keeps its stack.
        const label = providerErrorLabel(err);
        if (label) {
          console.error(`[worker] event ${event.id} (${event.providerEventId}) failed: ${label}`);
        } else {
          console.error(`[worker] event ${event.id} (${event.providerEventId}) failed`, err);
        }
        await markFailed(event.id, event.attempts, err);
      }
    }
    await sweepPayableCommissions();
    // Not awaited: emails go out on their own loop (sendEmails.ts), so a slow
    // or dead mail server never holds up the next event. Started here so the
    // emails this batch queued leave now rather than at the next poll.
    void runEmailSender();
  } finally {
    ticking = false;
  }
}
