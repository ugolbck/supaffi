// Who sent a request, as far as this process can tell.
//
// The bundled Caddy replaces any X-Forwarded-For a client sends with the
// address it actually saw, so behind it the rightmost entry is the visitor.
// Entries further left are whatever the client chose to send and are never
// read. When nothing set the header, Next fills it with the socket address,
// which behind any proxy is the proxy's own container or loopback address.

/** The rightmost X-Forwarded-For entry, else X-Real-IP, else null. */
export function clientAddress(headers: Headers): string | null {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const entries = forwarded.split(",").map((e) => e.trim()).filter(Boolean);
    const last = entries[entries.length - 1];
    if (last) return last;
  }
  const realIp = headers.get("x-real-ip")?.trim();
  return realIp || null;
}

/**
 * Loopback, private and link-local ranges. An address here is this server,
 * the Docker network, or a proxy in front of the app, never an internet
 * visitor as the bundled proxy reports them.
 */
export function isPrivateAddress(address: string): boolean {
  let value = address.trim().toLowerCase();
  if (value.startsWith("[")) value = value.slice(1, value.indexOf("]"));
  if (value.startsWith("::ffff:")) value = value.slice("::ffff:".length);

  const v4 = value.match(/^(\d{1,3})\.(\d{1,3})\.\d{1,3}\.\d{1,3}$/);
  if (v4) {
    const a = Number(v4[1]);
    const b = Number(v4[2]);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }

  return value === "::1" || /^f[cd]/.test(value) || /^fe[89ab]/.test(value);
}
