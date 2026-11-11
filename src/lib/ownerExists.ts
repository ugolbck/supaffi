import { db } from "@/lib/db";

// Deliberately its own module, importing nothing but the database client.
//
// Next.js compiles src/instrumentation.ts for every runtime it targets,
// including Edge, and Turbopack walks the whole reachable graph for each
// target — static imports and the targets of dynamic `import()` calls alike.
// The NEXT_RUNTIME guard in the startup hook is a runtime check, so it cannot
// keep anything out of that graph. `@/lib/owner` reaches the native Argon2
// binding through `@/lib/password`, which has no working Edge build, so the
// startup hook must not reach `@/lib/owner` at all. It reaches here instead.
//
// `@/lib/owner` re-exports this, so every other caller keeps its import.
// Keep this file's import list at exactly one entry.
export async function ownerExists(): Promise<boolean> {
  const count = await db.owner.count();
  return count > 0;
}

/**
 * Whether an owner session signed in at `signedInAtMs` (milliseconds since the
 * epoch) is still valid.
 *
 * Sessions are JWTs with no adapter behind them, so there is no session row to
 * delete when the password changes: a stolen cookie would otherwise stay good
 * for its full 30 days. Every owner session is checked against the stamp
 * `changeOwnerPassword` writes, which ends every session issued before it.
 * Both sides are in milliseconds: in whole seconds, a session signed in
 * earlier in the same second as the change would survive it.
 *
 * A missing owner row is not current, so a deleted account cannot keep a
 * session alive.
 */
export async function ownerSessionIsCurrent(
  ownerId: string,
  signedInAtMs: number | undefined
): Promise<boolean> {
  const owner = await db.owner.findUnique({
    where: { id: ownerId },
    select: { passwordChangedAt: true },
  });
  if (!owner) return false;
  if (!owner.passwordChangedAt) return true;
  // A token with no issued-at cannot be placed against the change, so it is
  // treated as older than it.
  if (signedInAtMs === undefined) return false;
  return signedInAtMs >= owner.passwordChangedAt.getTime();
}
