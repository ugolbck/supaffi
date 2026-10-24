// Rate limiting for Owner login.
//
// This exists because the dashboard is served on the server's own public
// address (Caddyfile.dashboard), so the login form is reachable by anything
// that scans the internet rather than only by whoever knew the instance
// domain.
//
// Only the real Owner's email is ever counted (see authorize in auth.ts). An
// attempt on any other email has no password to guess, and counting it would
// let a flood of made-up emails push the Owner's own entry out of the map.
//
// Two limits, both counted before the password hash runs rather than after a
// failure, so a burst of concurrent requests cannot all slip past the check
// while their hashes are still running:
//
// - A tight one on email and client address. This is the real brake on
//   guessing, and keying it on the address means a stranger tripping it locks
//   out their own address, not the Owner.
// - A looser one on the email alone. Behind a proxy that passes the forwarded
//   header through, the address can be made up, and without this a new
//   address per ten guesses would be unlimited guessing.
//
// The pair limit can have entries evicted by address rotation; the email limit
// cannot, because only Owner emails ever reach it.
//
// Separately, every login request of any email is counted per client address
// before anything else happens (reserveLoginRequest). An unknown email still
// runs a dummy hash so its timing matches the Owner's, which made a script
// posting made-up emails a cheap way to keep the Argon2 slots busy. Past this
// limit the request is refused without hashing at all. It is skipped when the
// address is missing or private, because then the proxy in front did not
// report the visitor and everyone would share one budget. The Argon2 queue cap
// in password.ts is what covers that case.

import { takeFromEach, windowLimit } from "@/lib/rateLimit";
import { isPrivateAddress } from "@/lib/clientAddress";

const WINDOW_MS = 15 * 60 * 1000;

// Generous: an Owner mistyping a few times, or a small office behind one
// address, never comes near it.
const perClient = windowLimit({
  name: "owner-login-client",
  windowMs: WINDOW_MS,
  max: 20,
  maxTracked: 5000,
});

const perAddress = windowLimit({
  name: "owner-login-address",
  windowMs: WINDOW_MS,
  max: 10,
  maxTracked: 2000,
});

const perEmail = windowLimit({
  name: "owner-login-email",
  windowMs: WINDOW_MS,
  max: 100,
  // The Owner and every product's affiliates, keyed by product and email.
  maxTracked: 5000,
});

// Matches verifyOwnerCredentials, or `Bob@x.com` and `bob@x.com` would be two
// separate budgets for one account.
function normalize(email: string): string {
  return email.trim().toLowerCase();
}

function pairKey(email: string, address: string): string {
  return `${normalize(email)}\n${address}`;
}

/**
 * Counts any login request from this client address and says whether it may
 * go on at all. Always allows a missing or private address, which is not a
 * visitor anyone can be told apart by.
 */
export function reserveLoginRequest(address: string | null, now: number = Date.now()): boolean {
  if (address === null || isPrivateAddress(address)) return true;
  return takeFromEach([[perClient, address]], now);
}

/**
 * Counts an attempt on the Owner's email and says whether it may go on to the
 * password hash. A refused attempt is not counted.
 *
 * `now` is injectable so the window can be tested without sleeping through
 * fifteen minutes of it.
 */
export function reserveLoginAttempt(
  email: string,
  address: string,
  now: number = Date.now()
): boolean {
  return takeFromEach(
    [
      [perAddress, pairKey(email, address)],
      [perEmail, normalize(email)],
    ],
    now
  );
}

/**
 * Called after a successful login. Clears only the address the Owner signed in
 * from: clearing the email limit too would hand a guesser running from other
 * addresses a fresh budget every time the Owner logs in.
 */
export function clearLoginAttempts(email: string, address: string): void {
  perAddress.clear(pairKey(email, address));
}

/** Test seam. Never called by application code. */
export function resetLoginThrottle(): void {
  perClient.reset();
  perAddress.reset();
  perEmail.reset();
}
