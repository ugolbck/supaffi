const globalForWorker = globalThis as unknown as { supaffiWorkerStarted?: boolean };

// Next.js's official startup hook — called once when a server instance is
// initiated. Starts the background worker that drains WebhookEvent and
// creates Commissions (ADR 0007). Gated on the Node runtime so this code
// (pg, server-side Stripe calls) never gets pulled into the Edge bundle.
//
// Next.js compiles this module for every runtime it targets, including Edge,
// and Turbopack walks the whole reachable graph for each target — static
// imports and the targets of dynamic `import()` calls alike. The NEXT_RUNTIME
// check below is a runtime guard: it stops this code from running on Edge, it
// cannot stop it from being bundled there.
//
// So nothing reachable from this file may fail to resolve on Edge. That rules
// out `@/lib/owner`, which reaches the native Argon2 binding through
// `@/lib/password` and has no working Edge build. The owner-existence check
// lives in `@/lib/ownerExists`, which imports only the database client, and
// that is what this file reaches. `@/lib/setupToken` is fine: it imports only
// `node:crypto`, which Edge warns about but resolves.
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
  // Dynamic, like startWorker's, for the same reason: it keeps the Prisma
  // client out of the Edge runtime's execution path. It is not what keeps
  // Argon2 out of the Edge bundle — only the import boundary above does that.
  const { ownerExists } = await import("@/lib/ownerExists");
  const { mintSetupToken } = await import("@/lib/setupToken");

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
  // The dashboard address comes first because it is the one that always
  // works: it needs no DNS record and no proxy in front of it. A domain is a
  // nicety somebody set deliberately, and it is only reachable once they have
  // also pointed it here.
  const hostIp = process.env.SUPAFFI_HOST_IP?.trim();
  const dashboardPort = process.env.SUPAFFI_DASHBOARD_PORT?.trim() || "3443";
  const domain = process.env.SUPAFFI_DOMAIN?.trim();
  const url = hostIp
    ? `https://${hostIp}:${dashboardPort}/setup`
    : domain
      ? `https://${domain}/setup`
      : "this instance's /setup page";
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
