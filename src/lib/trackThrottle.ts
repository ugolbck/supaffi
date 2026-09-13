// Limits on /api/track, which anyone on the internet can call and which writes
// a Click row for every valid code.
//
// Two rules, both per client address. A repeat of the same code from the same
// address inside the dedupe window gets the Referral Token it was already
// given instead of a new row, which is also what a visitor reloading a
// referred page should get. And one address can only start so many new clicks
// per window across all codes, so cycling through codes does not get around
// the first rule.
//
// In memory, not in the database and not in Redis (ADR 0005, ADR 0007), same
// as loginThrottle. A restart clears it, which costs at most one extra Click
// per visitor.

const DEDUPE_WINDOW_MS = 10 * 60 * 1000;
const ADDRESS_WINDOW_MS = 10 * 60 * 1000;
const MAX_NEW_CLICKS_PER_ADDRESS = 30;

// Both maps are keyed by what a caller sends, so both are capped. Map iterates
// in insertion order, so dropping from the front drops the oldest.
const MAX_TRACKED = 10_000;

type RecentClick = { referralToken: string; at: number };
type AddressWindow = { count: number; windowStartedAt: number };

const globalForThrottle = globalThis as unknown as {
  supaffiTrackClicks?: Map<string, RecentClick>;
  supaffiTrackAddresses?: Map<string, AddressWindow>;
};

// Held on globalThis so dev-mode Fast Refresh does not hand out empty maps.
const recentClicks: Map<string, RecentClick> =
  globalForThrottle.supaffiTrackClicks ?? new Map<string, RecentClick>();
const addresses: Map<string, AddressWindow> =
  globalForThrottle.supaffiTrackAddresses ?? new Map<string, AddressWindow>();
if (process.env.NODE_ENV !== "production") {
  globalForThrottle.supaffiTrackClicks = recentClicks;
  globalForThrottle.supaffiTrackAddresses = addresses;
}

function clickKey(address: string, code: string): string {
  return `${address} ${code}`;
}

function cap<V>(map: Map<string, V>): void {
  while (map.size > MAX_TRACKED) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

export type TrackDecision =
  | { kind: "reuse"; referralToken: string }
  | { kind: "limited" }
  | { kind: "new" };

/**
 * What to do with a click. `now` is injectable so windows can be tested
 * without waiting them out.
 */
export function decideClick(address: string, code: string, now: number = Date.now()): TrackDecision {
  const recent = recentClicks.get(clickKey(address, code));
  if (recent && now - recent.at < DEDUPE_WINDOW_MS) {
    return { kind: "reuse", referralToken: recent.referralToken };
  }

  const window = addresses.get(address);
  if (window && now - window.windowStartedAt < ADDRESS_WINDOW_MS && window.count >= MAX_NEW_CLICKS_PER_ADDRESS) {
    return { kind: "limited" };
  }
  return { kind: "new" };
}

/**
 * Records a new click before its row is written, so parallel requests from the
 * same address for the same code reuse this token rather than each inserting.
 */
export function rememberClick(
  address: string,
  code: string,
  referralToken: string,
  now: number = Date.now()
): void {
  const key = clickKey(address, code);
  recentClicks.delete(key);
  recentClicks.set(key, { referralToken, at: now });
  cap(recentClicks);

  const window = addresses.get(address);
  if (window && now - window.windowStartedAt < ADDRESS_WINDOW_MS) {
    window.count += 1;
  } else {
    addresses.delete(address);
    addresses.set(address, { count: 1, windowStartedAt: now });
    cap(addresses);
  }
}

/** Undoes rememberClick for a row that was never written. */
export function forgetClick(address: string, code: string, referralToken: string): void {
  const key = clickKey(address, code);
  if (recentClicks.get(key)?.referralToken === referralToken) recentClicks.delete(key);
}

/** Test seam. Never called by application code. */
export function resetTrackThrottle(): void {
  recentClicks.clear();
  addresses.clear();
}
