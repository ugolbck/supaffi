import { hash, verify } from "@node-rs/argon2";

// OWASP 2026 baseline for Argon2id: 64MB memory, 3 iterations, 4 parallel
// lanes. Tune up from here if the Instance's hardware can absorb more —
// this is a floor, not a ceiling.
const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB, in KiB
  timeCost: 3,
  parallelism: 4,
};

// Each hash or verify holds 64 MiB for as long as it runs, and the login form
// is public. Without a cap, a few hundred concurrent requests would each start
// one and take a small server down on memory alone. Extra callers wait their
// turn instead, which costs time rather than memory.
const MAX_CONCURRENT_ARGON2 = 2;

// The wait is capped too. An unbounded queue let a script posting logins keep
// both slots busy while the line grew, so the Owner's real attempt sat behind
// all of it until the request timed out. Past this many, a caller is turned
// away at once and the login answers "incorrect" like any other failure.
const MAX_WAITING_ARGON2 = 20;

/** Thrown when every slot is busy and the queue is already full. */
export class ConcurrencyLimitError extends Error {
  constructor() {
    super("Too many callers are already waiting");
    this.name = "ConcurrencyLimitError";
  }
}

/**
 * Wraps async work so no more than `max` calls run at once and no more than
 * `maxWaiting` wait for a turn. A caller past both is rejected straight away
 * with ConcurrencyLimitError. Exported for its test; the password functions
 * below are the only application callers.
 */
export function limitConcurrency(max: number, maxWaiting: number = Infinity) {
  let active = 0;
  const waiting: Array<() => void> = [];

  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active < max) {
      active += 1;
    } else if (waiting.length >= maxWaiting) {
      throw new ConcurrencyLimitError();
    } else {
      // The slot is handed over directly on release, so `active` already
      // counts this caller when it wakes.
      await new Promise<void>((resolve) => waiting.push(resolve));
    }
    try {
      return await work();
    } finally {
      const next = waiting.shift();
      if (next) next();
      else active -= 1;
    }
  };
}

const withArgon2Slot = limitConcurrency(MAX_CONCURRENT_ARGON2, MAX_WAITING_ARGON2);

export async function hashPassword(plain: string): Promise<string> {
  return withArgon2Slot(() => hash(plain, ARGON2_OPTIONS));
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return withArgon2Slot(() => verify(hashed, plain));
}
