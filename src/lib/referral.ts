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
 */
export const REFERRAL_METADATA_KEY = "supaffi_referral";
