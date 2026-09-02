// A Merchant's `domain` is a bare hostname (ADR 0006): it is what arrives in
// the Host header, and links back to the instance are built from it. In
// production that is always a real domain served over TLS, but in development
// it is `localhost:3600`, where an `https://` link is dead on arrival.
//
// Hardcoding the scheme is what made the affiliate magic link unclickable
// locally, which is exactly the flow the console email transport exists to
// make testable, so the two go together.
const LOCAL_HOSTNAMES = new Set(["localhost", "127.0.0.1", "0.0.0.0"]);

export function isLocalDomain(domain: string): boolean {
  // Bracketed IPv6 (`[::1]:3600`) does not split on ":" the way a hostname
  // does, so it is matched whole before anything else touches it.
  const value = domain.trim().toLowerCase();
  if (value.startsWith("[")) return value.startsWith("[::1]");

  const hostname = value.split(":")[0];
  return LOCAL_HOSTNAMES.has(hostname) || hostname.endsWith(".localhost");
}

/** `https://` for a real domain, `http://` for a local one. No trailing slash. */
export function originFor(domain: string): string {
  return `${isLocalDomain(domain) ? "http" : "https"}://${domain}`;
}
