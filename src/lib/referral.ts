/**
 * The two names the Referral Token travels under, once it leaves Supaffi and
 * crosses the Merchant's own site.
 *
 * Both live here so the script that writes them, the snippet the Owner is told
 * to copy, and the worker that reads them back can never drift apart.
 */

/**
 * First-party cookie the tracking script writes on the Merchant's own domain.
 *
 * Deliberately namespaced: it lands in the same jar as everything else the
 * Merchant's site sets, including their auth provider, and a short name is easy
 * to collide with.
 *
 * Read it by exact name. Matching `document.cookie` with a bare substring will
 * also hit any cookie whose name merely ends in this one.
 */
export const REFERRAL_COOKIE = "__supaffi_referral";

/**
 * Key the token travels under in the Checkout Session's `metadata`.
 *
 * Not `client_reference_id`, which is where most apps already put their own
 * user ID to link a Session back to the buyer. There is exactly one of that
 * field, so claiming it would make installing Supaffi cost the Merchant
 * something they were already using. `metadata` holds up to 50 keys and nothing
 * else claims this one.
 *
 * Checkouts the Merchant's own code does not build (Payment Links, buy
 * buttons, pricing tables) have no place for metadata, so they carry the token
 * in `client_reference_id` instead, see REFERRAL_CLIENT_REFERENCE_PREFIX.
 */
export const REFERRAL_METADATA_KEY = "supaffi_referral";

/**
 * Prefix in front of the token when it travels in the Checkout Session's
 * `client_reference_id`, e.g. `supaffi_<token>`.
 *
 * Used only for checkouts Stripe builds without the Merchant's code, where
 * `client_reference_id` is the one field the tracking script can set and
 * `metadata` is out of reach. Only values starting with this prefix are read,
 * because Merchants often put their own user ID in that field, and a bare
 * value must never be mistaken for a token. The token charset (letters,
 * digits, dashes, underscores) is what Stripe allows there, and the prefix
 * keeps the whole value well under its 200 character limit.
 */
export const REFERRAL_CLIENT_REFERENCE_PREFIX = "supaffi_";

/**
 * Query parameter carrying an Affiliate's referral code on their link, e.g.
 * `https://merchant.com/pricing?via=sarah`.
 *
 * `via` rather than `ref`: `ref` is already taken on most sites, by analytics
 * tools, generic referrer plumbing, and the merchant's own campaign tags, so
 * an affiliate link would collide with whatever is there. `via` is also what
 * Rewardful uses, which is the spelling affiliates already recognise.
 */
export const REFERRAL_QUERY_PARAM = "via";

/**
 * The clicks a visitor actually made, for every count of clicks. A promo code
 * sale records a click of its own so it can earn like any other referral, but
 * nobody clicked anything, and counting it would inflate clicks and flatter
 * the conversion rate.
 */
export const VISITOR_CLICK = { promoCheckoutSessionId: null } as const;
