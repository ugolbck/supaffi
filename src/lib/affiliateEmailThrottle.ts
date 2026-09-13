// Rate limiting for the emails an anonymous visitor can trigger: the Affiliate
// login link and the signup link.
//
// Each one goes out through the Merchant's own Resend key and from the
// Merchant's own domain, so an unthrottled form is a way to bomb someone's
// inbox in the Merchant's name, burn the Merchant's sending quota and damage
// their domain's reputation.
//
// Callers show the same "check your email" response whether or not this lets
// the email through. Saying "too many requests" would confirm to a stranger
// that the address is tracked, which is the thing the neutral response exists
// to hide.
//
// The recipient limit is deliberately short. Anyone can trigger it for any
// email, so a longer one (there used to be five an hour) let a stranger spend
// a chosen Affiliate's allowance and quietly stop their login links. One a
// minute stops a burst and costs the real Affiliate at most a minute's wait.
// What bounds a single inbox beyond that is the per-address limit, and the
// database keeping only the newest few login tokens (createAffiliateLoginToken).

import { takeFromEach, windowLimit, type WindowLimit } from "@/lib/rateLimit";
import { isPrivateAddress } from "@/lib/clientAddress";

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;

// One email a minute, so a double click or an impatient resend does not queue
// up a stack of links.
const perRecipientBurst = windowLimit({
  name: "affiliate-email-recipient-minute",
  windowMs: MINUTE_MS,
  max: 1,
  maxTracked: 5000,
});

// Generous enough for an office sharing one address signing up together.
const perAddressHour = windowLimit({
  name: "affiliate-email-address-hour",
  windowMs: HOUR_MS,
  max: 20,
  maxTracked: 5000,
});

/**
 * Counts one email to this recipient and says whether it may be sent.
 *
 * Keyed on the Merchant too, because Affiliate email is only unique per
 * Merchant and each Merchant's quota is their own.
 *
 * The per-address limit only applies to an internet visitor, as in
 * /api/track. A missing or private address means the proxy in front did not
 * report the visitor, and counting it would put every visitor on the instance
 * in one shared budget of twenty emails an hour.
 */
export function reserveAffiliateEmail(
  merchantId: string,
  email: string,
  address: string | null,
  now: number = Date.now()
): boolean {
  const recipient = `${merchantId}\n${email.trim().toLowerCase()}`;
  const limits: Array<readonly [WindowLimit, string]> = [[perRecipientBurst, recipient]];
  if (address !== null && !isPrivateAddress(address)) limits.push([perAddressHour, address]);
  return takeFromEach(limits, now);
}

/** Test seam. Never called by application code. */
export function resetAffiliateEmailThrottle(): void {
  perRecipientBurst.reset();
  perAddressHour.reset();
}
