import { runTick } from "./tick";
import { runEmailSender } from "./sendEmails";
import { startListening } from "./listen";
import { paymentProviders } from "@/lib/payments";
import { isDevInstance } from "@/lib/instanceMode";

const POLL_INTERVAL_MS = 5_000;

export function startWorker(): void {
  console.log("[worker] starting");

  const interval = setInterval(() => {
    runTick().catch((err) => console.error("[worker] tick failed", err));
  }, POLL_INTERVAL_MS);
  interval.unref();

  // Its own loop, so retries come due even when no event arrives.
  setInterval(() => void runEmailSender(), POLL_INTERVAL_MS).unref();

  startListening(() => {
    runTick().catch((err) => console.error("[worker] notified tick failed", err));
  });

  runTick().catch((err) => console.error("[worker] initial tick failed", err));

  // Endpoints made by an earlier release lack events added since, so they
  // are brought up to date once per start. Not awaited: it talks to the
  // payment provider for every product and must not delay the queue. Skipped
  // on a developer's machine, where seeded products carry keys the provider
  // has never seen and every start would log a page of failures.
  if (!isDevInstance()) {
    for (const provider of paymentProviders) {
      provider.upgradeWebhookEndpoints?.().catch((err) => console.error("[worker] webhook event upgrade failed", err));
    }
  }
}
