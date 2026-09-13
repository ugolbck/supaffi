// Fixed-window counters held in memory, shared by the Owner login throttle
// and the Affiliate email throttle.
//
// In memory, not in the database and not in Redis (ADR 0005, ADR 0007). A
// restart clears the counters, which is acceptable: an attacker cannot cause
// one, and every limit built on this is a brake rather than a record.

type Window = { count: number; startedAt: number };

const globalForRateLimit = globalThis as unknown as {
  supaffiRateLimits?: Map<string, Map<string, Window>>;
};

// Held on globalThis for the same reason the Prisma client is: dev-mode Fast
// Refresh re-evaluates the module and would otherwise hand out fresh, empty
// counters on every edit.
const stores: Map<string, Map<string, Window>> =
  globalForRateLimit.supaffiRateLimits ?? new Map<string, Map<string, Window>>();
if (process.env.NODE_ENV !== "production") {
  globalForRateLimit.supaffiRateLimits = stores;
}

export type WindowLimit = {
  /** Whether one more hit on this key still fits in the current window. */
  allows(key: string, now: number): boolean;
  hit(key: string, now: number): void;
  clear(key: string): void;
  /** Test seam. Never called by application code. */
  reset(): void;
};

export function windowLimit(options: {
  /** Unique per limit, so two limits never share a store after Fast Refresh. */
  name: string;
  windowMs: number;
  max: number;
  /**
   * Keys are attacker-supplied, so an unbounded map would itself be a way to
   * exhaust memory. Entries are inserted in first-seen order, which is the
   * order Map iterates in, so dropping from the front drops the oldest. Every
   * caller must stay safe when one of its keys is evicted early, which is why
   * each limit keyed by something an attacker can vary freely sits next to one
   * they cannot.
   */
  maxTracked: number;
}): WindowLimit {
  const { name, windowMs, max, maxTracked } = options;
  let entries = stores.get(name);
  if (!entries) {
    entries = new Map<string, Window>();
    stores.set(name, entries);
  }
  const windows = entries;

  function current(key: string, now: number): Window | null {
    const entry = windows.get(key);
    if (!entry) return null;
    if (now - entry.startedAt >= windowMs) {
      windows.delete(key);
      return null;
    }
    return entry;
  }

  return {
    allows(key, now) {
      const entry = current(key, now);
      return !entry || entry.count < max;
    },
    hit(key, now) {
      const entry = current(key, now);
      if (entry) {
        entry.count += 1;
        return;
      }
      // An expired entry was deleted by current(), so this lands at the end
      // of the iteration order and the eviction below keeps dropping
      // genuinely stale keys.
      windows.set(key, { count: 1, startedAt: now });
      while (windows.size > maxTracked) {
        const oldest = windows.keys().next();
        if (oldest.done) break;
        windows.delete(oldest.value);
      }
    },
    clear(key) {
      windows.delete(key);
    },
    reset() {
      windows.clear();
    },
  };
}

/**
 * Counts one hit against every limit, but only if all of them still allow it.
 *
 * All or nothing, so a request refused by one limit does not also spend the
 * budget of the others. Synchronous, so two concurrent requests cannot both
 * read "allowed" before either has counted.
 */
export function takeFromEach(
  limits: ReadonlyArray<readonly [WindowLimit, string]>,
  now: number
): boolean {
  if (!limits.every(([limit, key]) => limit.allows(key, now))) return false;
  for (const [limit, key] of limits) limit.hit(key, now);
  return true;
}
