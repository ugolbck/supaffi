import { resolve4, resolveNs } from "node:dns/promises";

export type CheckResult = { ok: boolean; detail: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * Whether the hostname's A record points at this server. `expected` is
 * SUPAFFI_HOST_IP, which install.sh lets the owner set to a hostname as well
 * as to a literal address, so a non-literal is resolved with the same
 * resolver and any shared address counts as a match.
 */
export async function resolvesTo(
  hostname: string,
  expected: string,
  resolve: (h: string) => Promise<string[]> = resolve4
): Promise<CheckResult> {
  let addresses: string[];
  try {
    addresses = await resolve(hostname);
  } catch {
    return { ok: false, detail: "No record found yet" };
  }

  if (IPV4.test(expected)) {
    if (addresses.includes(expected)) return { ok: true, detail: `Points at ${expected}` };
    return { ok: false, detail: `Points at ${addresses.join(", ")}, not this server` };
  }

  let expectedAddresses: string[];
  try {
    expectedAddresses = await resolve(expected);
  } catch {
    expectedAddresses = [];
  }
  if (expectedAddresses.length === 0) {
    return { ok: false, detail: `This server's address (${expected}) could not be resolved` };
  }
  const shared = addresses.find((a) => expectedAddresses.includes(a));
  if (shared) return { ok: true, detail: `Points at ${shared}` };
  return { ok: false, detail: `Points at ${addresses.join(", ")}, not this server` };
}

const CERT_CODES = new Set([
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
  "CERT_HAS_EXPIRED",
  "DEPTH_ZERO_SELF_SIGNED_CERT",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "ERR_TLS_CERT_ALTNAME_INVALID",
]);

/**
 * Whether the hostname answers over HTTPS with a certificate a browser would
 * accept. One request to the tracking script, which every product serves.
 * A certificate failure still proves the server was reached, so it reports
 * reachable and fails only the certificate light.
 */
export async function httpsReachable(
  hostname: string,
  fetchFn: typeof fetch = fetch
): Promise<{ reachable: CheckResult; certificate: CheckResult }> {
  try {
    const response = await fetchFn(`https://${hostname}/track.js`, {
      method: "HEAD",
      redirect: "manual",
      signal: AbortSignal.timeout(5000),
    });
    if (response.status >= 500) {
      return {
        reachable: { ok: true, detail: "Reached, but the server returned an error" },
        certificate: { ok: true, detail: "Valid" },
      };
    }
    return { reachable: { ok: true, detail: "Answers" }, certificate: { ok: true, detail: "Valid" } };
  } catch (err) {
    const code = (err as { cause?: { code?: string } })?.cause?.code ?? "";
    if (CERT_CODES.has(code)) {
      return {
        reachable: { ok: true, detail: "Answers" },
        certificate: { ok: false, detail: "Not issued yet. Usually a minute after DNS resolves." },
      };
    }
    return {
      reachable: { ok: false, detail: "Nothing answered" },
      certificate: { ok: false, detail: "Waiting" },
    };
  }
}

/**
 * Which DNS provider hosts the domain, from the nameservers of the
 * registrable domain. Only Cloudflare is recognised today, because it is the
 * only one with a deep link worth showing. The subdomain's own NS lookup is
 * skipped: a subdomain almost never has its own NS records.
 */
export async function detectDnsProvider(
  hostname: string,
  resolve: (h: string) => Promise<string[]> = resolveNs
): Promise<"cloudflare" | "unknown"> {
  const parts = hostname.split(".");
  // Two labels is the common case (instantgradient.com). Three covers
  // registrable domains under a public suffix like co.uk without pulling in
  // the whole suffix list.
  const candidates = [parts.slice(-2).join("."), parts.slice(-3).join(".")];
  for (const candidate of candidates) {
    try {
      const servers = await resolve(candidate);
      if (servers.some((s) => s.toLowerCase().endsWith(".ns.cloudflare.com"))) return "cloudflare";
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}
