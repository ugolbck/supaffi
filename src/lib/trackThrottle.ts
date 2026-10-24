// Limit on /api/track, which anyone on the internet can call and which writes
// a Click row for every valid code.
//
// One address can only start so many new clicks per window. Repeat visits are
// not recognised here: an address is shared by an office or a mobile carrier,
// so handing one visitor's token to another would merge two customers into one
// referral. The route recognises a repeat by the token the visitor's own
// browser sends back instead.
//
// In memory, not in the database and not in Redis (ADR 0005, ADR 0007), same
// as loginThrottle. A restart clears it.

const ADDRESS_WINDOW_MS = 10 * 60 * 1000;
const MAX_NEW_CLICKS_PER_ADDRESS = 30;

// Keyed by what a caller sends, so capped. Map iterates in insertion order, so
// dropping from the front drops the oldest.
const MAX_TRACKED = 10_000;

type AddressWindow = { count: number; windowStartedAt: number };

const globalForThrottle = globalThis as unknown as {
  supaffiTrackAddresses?: Map<string, AddressWindow>;
};

// Held on globalThis so dev-mode Fast Refresh does not hand out an empty map.
const addresses: Map<string, AddressWindow> =
  globalForThrottle.supaffiTrackAddresses ?? new Map<string, AddressWindow>();
if (process.env.NODE_ENV !== "production") {
  globalForThrottle.supaffiTrackAddresses = addresses;
}

function cap<V>(map: Map<string, V>): void {
  while (map.size > MAX_TRACKED) {
    const oldest = map.keys().next();
    if (oldest.done) break;
    map.delete(oldest.value);
  }
}

/**
 * Whether this address may start another click. `now` is injectable so the
 * window can be tested without waiting it out.
 */
export function isClickLimited(address: string, now: number = Date.now()): boolean {
  const window = addresses.get(address);
  return Boolean(
    window && now - window.windowStartedAt < ADDRESS_WINDOW_MS && window.count >= MAX_NEW_CLICKS_PER_ADDRESS
  );
}

/** Counts a new click against its address. */
export function rememberClick(address: string, now: number = Date.now()): void {
  const window = addresses.get(address);
  if (window && now - window.windowStartedAt < ADDRESS_WINDOW_MS) {
    window.count += 1;
  } else {
    addresses.delete(address);
    addresses.set(address, { count: 1, windowStartedAt: now });
    cap(addresses);
  }
}

/** Test seam. Never called by application code. */
export function resetTrackThrottle(): void {
  addresses.clear();
}
