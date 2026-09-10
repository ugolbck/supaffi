import { Resolver, resolve4, resolveNs } from "node:dns/promises";

export type CheckResult = { ok: boolean; detail: string };

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/;

/**
 * The registrable domain, guessed. Two labels covers mokkit.co; three covers
 * a registrable domain under a public suffix like co.uk without pulling the
 * whole suffix list into the bundle.
 */
export function registrableCandidates(hostname: string): string[] {
  const parts = hostname.split(".");
  return [parts.slice(-2).join("."), parts.slice(-3).join(".")];
}

export type AuthoritativeDeps = {
  resolveNs: (h: string) => Promise<string[]>;
  resolve4: (h: string) => Promise<string[]>;
  makeResolver: (servers: string[]) => { resolve4: (h: string) => Promise<string[]> };
};

const authoritativeDefaults: AuthoritativeDeps = {
  resolveNs,
  resolve4,
  makeResolver: (servers) => {
    const resolver = new Resolver();
    resolver.setServers(servers);
    return resolver;
  },
};

/**
 * Resolves a name by asking the zone's own nameservers, skipping every cache
 * between here and them.
 *
 * The onboarding step polls this name before the owner has created the
 * record, so the first answer is always "does not exist". A recursive
 * resolver is entitled to remember that for the zone's SOA minimum, which at
 * Cloudflare is half an hour, and the host's resolver sits outside the
 * containers so no restart or redeploy clears it. The flow was reliably
 * poisoning itself; see finding 3.
 *
 * Falls back to the ordinary resolver whenever the authoritative path cannot
 * be established, because a slow or unusual zone must not make the check
 * worse than it was.
 */
export async function resolveAuthoritative(
  hostname: string,
  deps: AuthoritativeDeps = authoritativeDefaults
): Promise<string[]> {
  for (const zone of registrableCandidates(hostname)) {
    let nameservers: string[];
    try {
      nameservers = await deps.resolveNs(zone);
    } catch {
      continue;
    }
    if (nameservers.length === 0) continue;

    const addresses: string[] = [];
    for (const ns of nameservers) {
      try {
        addresses.push(...(await deps.resolve4(ns)));
      } catch {
        // One unreachable nameserver out of four is normal.
      }
    }
    if (addresses.length === 0) continue;

    return deps.makeResolver(addresses).resolve4(hostname);
  }
  return deps.resolve4(hostname);
}

/**
 * Whether the hostname's A record points at this server. `expected` is
 * SUPAFFI_HOST_IP, which install.sh lets the owner set to a hostname as well
 * as to a literal address, so a non-literal is resolved with the same
 * resolver and any shared address counts as a match.
 */
export async function resolvesTo(
  hostname: string,
  expected: string,
  resolve: (h: string) => Promise<string[]> = resolveAuthoritative
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
  fetchFn: typeof fetch = fetch,
  resolve: (h: string) => Promise<string[]> = resolveAuthoritative
): Promise<{ reachable: CheckResult; certificate: CheckResult }> {
  try {
    const addresses = await resolve(hostname);
    if (addresses.length === 0) {
      return {
        reachable: { ok: false, detail: "No record found yet" },
        certificate: { ok: false, detail: "Waiting for the record" },
      };
    }
  } catch {
    return {
      reachable: { ok: false, detail: "No record found yet" },
      certificate: { ok: false, detail: "Waiting for the record" },
    };
  }

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

const NS_TIMEOUT_MS = 3000;

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
  // A resolver that never answers would otherwise hold the whole subdomain
  // step open: this runs during the render, and the answer only decides
  // whether one deep link is shown.
  const withTimeout = async (h: string) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        resolve(h),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("Nameserver lookup timed out")), NS_TIMEOUT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  for (const candidate of registrableCandidates(hostname)) {
    try {
      const servers = await withTimeout(candidate);
      if (servers.some((s) => s.toLowerCase().endsWith(".ns.cloudflare.com"))) return "cloudflare";
    } catch {
      // try the next candidate
    }
  }
  return "unknown";
}
