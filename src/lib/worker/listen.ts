import { Client } from "pg";

const CHANNEL = "webhook_event_inserted";
const RECONNECT_DELAY_MS = 5_000;

// Best-effort wake-up only (ADR 0007) — the polling interval in index.ts is
// the source of truth, this only makes the common case (an event arrives,
// worker is idle) feel instant instead of waiting up to the poll interval.
// A dropped connection here degrades silently back to plain polling and
// auto-reconnects — that's intentional, not a failure worth surfacing.
export function startListening(onNotify: () => void): void {
  async function connect(): Promise<void> {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    try {
      await client.connect();
      await client.query(`LISTEN ${CHANNEL}`);
      client.on("notification", onNotify);
      client.on("error", () => {
        client.end().catch(() => {});
        setTimeout(connect, RECONNECT_DELAY_MS);
      });
    } catch {
      setTimeout(connect, RECONNECT_DELAY_MS);
    }
  }

  connect();
}
