import { runTick } from "./tick";
import { startListening } from "./listen";

const POLL_INTERVAL_MS = 5_000;

export function startWorker(): void {
  console.log("[worker] starting");

  const interval = setInterval(() => {
    runTick().catch((err) => console.error("[worker] tick failed", err));
  }, POLL_INTERVAL_MS);
  interval.unref();

  startListening(() => {
    runTick().catch((err) => console.error("[worker] notified tick failed", err));
  });

  runTick().catch((err) => console.error("[worker] initial tick failed", err));
}
