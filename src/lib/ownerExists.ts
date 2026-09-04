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
