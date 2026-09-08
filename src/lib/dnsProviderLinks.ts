/**
 * Cloudflare's documented deep link into a zone's DNS records. Cloudflare
 * asks the user to pick the account and zone, then lands on the records
 * page. The `:account` and `:zone` placeholders are literal; Cloudflare
 * resolves them after login.
 *
 * Domain Connect, which writes the record with one approval, is the later
 * step; it needs a template registered with Cloudflare and a signing key on
 * supaffi.com, and belongs with the install service on the website.
 */
export function cloudflareDnsRecordsUrl(): string {
  return "https://dash.cloudflare.com/?to=/:account/:zone/dns/records";
}
