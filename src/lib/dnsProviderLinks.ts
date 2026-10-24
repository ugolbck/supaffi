/**
 * Cloudflare's deep link into a zone's DNS records. `:account` is a literal
 * placeholder Cloudflare resolves after login, asking only when the user has
 * several accounts. The zone goes in by name, which lands on that domain's
 * records instead of the list of domains; Cloudflare documents only the
 * `:zone` placeholder form, so this relies on its URLs naming zones.
 *
 * Domain Connect, which writes the record with one approval, is the later
 * step; it needs a template registered with Cloudflare and a signing key on
 * supaffi.com, and belongs with the install service on the website.
 */
export function cloudflareDnsRecordsUrl(zone: string): string {
  return `https://dash.cloudflare.com/?to=/:account/${encodeURIComponent(zone)}/dns/records`;
}
