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
   * they cannot, or uses the "fewestHits" eviction below.
   */
  maxTracked: number;
  /**
   * What gives way when the map is full. "oldest" (the default) drops the
   * first-seen key. "fewestHits" is for a limit whose keys an attacker can
   * also supply, in numbers, while still needing the limit to hold for one
   * key: it drops an expired key if there is one, else the key with the
   * fewest hits, never one already at the limit. Pushing a key out then takes
   * more hits on every other key than that key has, and a key that is
   * limiting stays limited until its window ends. When every key is at the
   * limit there is nothing safe to drop, and a new key is refused until one
   * expires. Each insert past the cap scans the map, so keep maxTracked to a
   * few thousand.
   */
  eviction?: "oldest" | "fewestHits";
}): WindowLimit {
  const { name, windowMs, max, maxTracked, eviction = "oldest" } = options;
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

  // The key "fewestHits" would drop to make room, or null when every key is
  // at the limit. An expired key is the best choice and ends the scan.
  function evictable(now: number): string | null {
    let choice: string | null = null;
    let fewest = max;
    for (const [key, entry] of windows) {
      if (now - entry.startedAt >= windowMs) return key;
      // Strictly fewer, so a tie keeps the first seen, which is the oldest.
      if (entry.count < fewest) {
        choice = key;
        fewest = entry.count;
      }
    }
    return choice;
  }

  return {
    allows(key, now) {
      const entry = current(key, now);
      if (entry) return entry.count < max;
      if (eviction === "fewestHits" && windows.size >= maxTracked) return evictable(now) !== null;
      return true;
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
      if (eviction === "fewestHits") {
        while (windows.size >= maxTracked) {
          const victim = evictable(now);
          // allows() said no in this case; a caller that hits anyway is not
          // tracked rather than pushing out a key that is limiting.
          if (victim === null) return;
          windows.delete(victim);
        }
        windows.set(key, { count: 1, startedAt: now });
        return;
      }
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
