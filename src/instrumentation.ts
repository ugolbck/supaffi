import { ownerExists } from "@/lib/owner";
import { mintSetupToken } from "@/lib/setupToken";

const globalForWorker = globalThis as unknown as { supaffiWorkerStarted?: boolean };

// Next.js's official startup hook — called once when a server instance is
// initiated. Starts the background worker that drains WebhookEvent and
// creates Commissions (ADR 0007). Gated on the Node runtime so this code
// (pg, server-side Stripe calls) never gets pulled into the Edge bundle.
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  if (globalForWorker.supaffiWorkerStarted) return; // dev-mode Fast Refresh guard, same pattern as db.ts
  globalForWorker.supaffiWorkerStarted = true;

  await announceSetupTokenIfNeeded();

  const { startWorker } = await import("@/lib/worker");
  startWorker();
}

// Printed before the worker starts so it is the first thing an operator sees
// in `docker compose logs app`, and so the installer can pick it out of the
// stream without racing the worker's own output.
async function announceSetupTokenIfNeeded(): Promise<void> {
  try {
    if (await ownerExists()) return;
  } catch (err) {
    // Deliberately no token: setup stays closed rather than opening on a
    // database we could not question. verifySetupToken fails closed, so the
    // wizard rejects everything until this resolves and the container
    // restarts.
    console.error(
      "[setup] could not check whether an Owner exists, so no setup token was issued. Setup stays closed until this is resolved and the container restarts.",
      err
    );
    return;
  }

  const token = mintSetupToken();
  const domain = process.env.SUPAFFI_DOMAIN?.trim();
  const url = domain ? `https://${domain}/setup` : "this instance's /setup page";
  console.log(
    [
      "",
      "────────────────────────────────────────────────────────────────────────",
      "  This Supaffi instance has no Owner yet.",
      "",
      `  setup token: ${token}`,
      "",
      `  Open ${url} and paste it in.`,
      "  Valid until an Owner is created. Restarting issues a new one.",
      "────────────────────────────────────────────────────────────────────────",
      "",
    ].join("\n")
  );
}
