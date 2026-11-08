// Limit on "Forgot password?": each request sends an email from the Owner's
// own server, so an open form would let anyone spend their sending quota or
// fill an Affiliate's inbox.

import { takeFromEach, windowLimit } from "@/lib/rateLimit";
import { isPrivateAddress } from "@/lib/clientAddress";

const perAccountHour = windowLimit({ name: "password-link-account-hour", windowMs: 60 * 60 * 1000, max: 3, maxTracked: 5000 });
const perAddressHour = windowLimit({ name: "password-link-address-hour", windowMs: 60 * 60 * 1000, max: 10, maxTracked: 5000 });

/**
 * Counts one request and says whether it may send. The address is only
 * counted for an internet visitor, as on signup: a private one means the proxy
 * did not pass the visitor's address on.
 */
export function reservePasswordLink(merchantId: string, email: string, address: string | null, now: number = Date.now()): boolean {
  const limits: [typeof perAccountHour, string][] = [[perAccountHour, `${merchantId}\n${email}`]];
  if (address !== null && !isPrivateAddress(address)) limits.push([perAddressHour, `${merchantId}\n${address}`]);
  return takeFromEach(limits, now);
}

/** Test seam. Never called by application code. */
export function resetPasswordLinkThrottle(): void {
  perAccountHour.reset();
  perAddressHour.reset();
}
