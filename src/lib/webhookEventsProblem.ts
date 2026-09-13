/**
 * Which products have a Stripe webhook that could not be brought up to every
 * event the worker handles, and why.
 *
 * Held in memory rather than in a column because it is re-established on
 * every start and whenever a Stripe credential is replaced, and the whole app
 * runs as one process, so the settings page and the worker share it. Kept on
 * globalThis because Next compiles the startup hook and the pages as separate
 * bundles, each with its own copy of this module; the global is the one thing
 * both see, the same reason db.ts keeps the Prisma client there.
 *
 * A network failure is deliberately not recorded: it says nothing about the
 * endpoint, and a red light that clears itself on the next start would only
 * teach the owner to ignore it.
 */
export type WebhookEventsProblem = "permission" | "missing";

const globalForProblems = globalThis as unknown as {
  supaffiWebhookEventsProblems?: Map<string, WebhookEventsProblem>;
};

function problems(): Map<string, WebhookEventsProblem> {
  globalForProblems.supaffiWebhookEventsProblems ??= new Map();
  return globalForProblems.supaffiWebhookEventsProblems;
}

/** Records the problem for a product, or clears it when given null. */
export function recordWebhookEventsProblem(
  merchantId: string,
  problem: WebhookEventsProblem | null
): void {
  if (problem) problems().set(merchantId, problem);
  else problems().delete(merchantId);
}

export function webhookEventsProblem(merchantId: string): WebhookEventsProblem | null {
  return problems().get(merchantId) ?? null;
}
