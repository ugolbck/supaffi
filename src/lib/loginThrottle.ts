// Rate limiting for Owner login.
//
// This exists because the dashboard is served on the server's own public
// address (Caddyfile.dashboard), so the login form is reachable by anything
// that scans the internet rather than only by whoever knew the instance
// domain. Every attempt costs 64 MiB of Argon2id, which makes an unthrottled
// form a way to exhaust a small server's memory without ever guessing a
// password.
//
// Keyed by email, not by IP. A self-hosted instance has one Owner, so the
// email is the whole keyspace, and unlike a forwarded-for header it cannot be
// spoofed to dodge the limit. Keying on a client address behind a proxy would
// also mean trusting a header the app cannot verify.
//
// In memory, not in the database and not in Redis (ADR 0005, ADR 0007). A
// restart clears the counters, which is acceptable: an attacker cannot cause
// one, and an Owner who has locked themselves out has a way back.

const WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILURES = 10;

// An unbounded map keyed by attacker-supplied email would itself be the
// memory exhaustion this module exists to prevent, so it is capped. Entries
// are inserted in first-seen order, which is the order Map iterates in, so
// dropping from the front drops the oldest.
const MAX_TRACKED = 2000;

type Failures = { count: number; windowStartedAt: number };

const globalForThrottle = globalThis as unknown as {
  supaffiLoginFailures?: Map<string, Failures>;
};

// Held on globalThis for the same reason the Prisma client is: dev-mode Fast
// Refresh re-evaluates the module and would otherwise hand out a fresh, empty
// map on every edit.
const failures: Map<string, Failures> =
  globalForThrottle.supaffiLoginFailures ?? new Map<string, Failures>();
if (process.env.NODE_ENV !== "production") {
  globalForThrottle.supaffiLoginFailures = failures;
}

// Matches verifyOwnerCredentials, or `Bob@x.com` and `bob@x.com` would be two
// separate budgets for one account.
function key(email: string): string {
  return email.trim().toLowerCase();
}

function currentWindow(k: string, now: number): Failures | null {
  const entry = failures.get(k);
  if (!entry) return null;
  if (now - entry.windowStartedAt >= WINDOW_MS) {
    failures.delete(k);
    return null;
  }
  return entry;
}

/**
 * Whether another attempt for this email may proceed to the password hash.
 *
 * `now` is injectable so the window can be tested without sleeping through
 * fifteen minutes of it.
 */
export function checkLoginAllowed(email: string, now: number = Date.now()): boolean {
  const entry = currentWindow(key(email), now);
  return !entry || entry.count < MAX_FAILURES;
}

export function recordFailedLogin(email: string, now: number = Date.now()): void {
  const k = key(email);
  const entry = currentWindow(k, now);
  if (entry) {
    entry.count += 1;
    return;
  }
  // Re-inserting moves the key to the end of the iteration order, which is
  // what keeps the eviction below dropping genuinely stale entries.
  failures.delete(k);
  failures.set(k, { count: 1, windowStartedAt: now });

  while (failures.size > MAX_TRACKED) {
    const oldest = failures.keys().next();
    if (oldest.done) break;
    failures.delete(oldest.value);
  }
}

export function clearLoginFailures(email: string): void {
  failures.delete(key(email));
}

/** Test seam. Never called by application code. */
export function resetLoginThrottle(): void {
  failures.clear();
}
