// Limit on the public affiliate signup form: each signup writes an Affiliate
// row and runs an Argon2 hash, so an unthrottled form fills the Merchant's
// affiliate list with junk and holds the hashing slots the logins need.

import { takeFromEach, windowLimit } from "@/lib/rateLimit";
import { isPrivateAddress } from "@/lib/clientAddress";

// Generous enough for an office sharing one address signing up together.
const perAddressHour = windowLimit({
  name: "affiliate-signup-address-hour",
  windowMs: 60 * 60 * 1000,
  max: 20,
  maxTracked: 5000,
});

/**
 * Counts one signup from this address on this product and says whether it
 * may go ahead. Only an internet visitor is counted, as in /api/track: a
 * missing or private address means the proxy in front did not report the
 * visitor, and counting it would put every visitor in one shared budget.
 */
export function reserveAffiliateSignup(merchantId: string, address: string | null, now: number = Date.now()): boolean {
  if (address === null || isPrivateAddress(address)) return true;
  return takeFromEach([[perAddressHour, `${merchantId}\n${address}`]], now);
}

/** Test seam. Never called by application code. */
export function resetAffiliateSignupThrottle(): void {
  perAddressHour.reset();
}
