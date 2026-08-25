const globalForWorker = globalThis as unknown as { supaffiWorkerStarted?: boolean };

// Next.js's official startup hook — called once when a server instance is
// initiated. Starts the background worker that drains WebhookEvent and
// creates Commissions (ADR 0007). Gated on the Node runtime so this code
// (pg, server-side Stripe calls) never gets pulled into the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalForWorker.supaffiWorkerStarted) return; // dev-mode Fast Refresh guard, same pattern as db.ts
  globalForWorker.supaffiWorkerStarted = true;

  const { startWorker } = await import("@/lib/worker");
  startWorker();
}
