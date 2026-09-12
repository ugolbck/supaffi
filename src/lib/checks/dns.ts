import { Resolver, resolve4, resolveNs } from "node:dns/promises";
import { connect, type PeerCertificate } from "node:tls";

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
 * Candidates are tried longest first. A name under a multi-label public
 * suffix like co.uk has its zone at the three label form, and asking the
 * suffix itself for the record only earns a referral, which c-ares reports
 * as ENODATA. The three label lookup simply fails on a plain domain like
 * dev.mokkit.co and falls through to the two label form.
 *
 * Falls back to the ordinary resolver whenever the authoritative path cannot
 * be established, because a slow or unusual zone must not make the check
 * worse than it was. Only ENOTFOUND from the zone's own nameservers is taken
 * at face value: that one really does mean the record is not there yet.
 */
export async function resolveAuthoritative(
  hostname: string,
  deps: AuthoritativeDeps = authoritativeDefaults
): Promise<string[]> {
  for (const zone of [...registrableCandidates(hostname)].reverse()) {
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

    try {
      return await deps.makeResolver(addresses).resolve4(hostname);
    } catch (err) {
      if ((err as { code?: string })?.code === "ENOTFOUND") throw err;
      return deps.resolve4(hostname);
    }
  }
  return deps.resolve4(hostname);
}

/**
 * Whether the hostname's A record points at this server. `expected` is
 * SUPAFFI_HOST_IP, which install.sh lets the owner set to a hostname as well
 * as to a literal address, so a non-literal is resolved and any shared
 * address counts as a match. `expected` is resolved with the plain resolver,
 * not the authoritative one: it is not the name being waited on, so there is
 * no stale-negative-cache problem to work around for it.
 */
export async function resolvesTo(
  hostname: string,
  expected: string,
  resolve: (h: string) => Promise<string[]> = resolveAuthoritative,
  resolveExpected: (h: string) => Promise<string[]> = resolve4
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
    expectedAddresses = await resolveExpected(expected);
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
 * The reverse proxy in front of this app, as seen from inside it. Compose
 * names the service `caddy`, and the probe below talks to it directly. An
 * instance running behind somebody else's proxy has no such host, the
 * connection is refused, and the check falls back to the round trip.
 */
const PROXY_HOST = process.env.SUPAFFI_PROXY_HOST?.trim() || "caddy";
const PROXY_PORT = Number(process.env.SUPAFFI_PROXY_PORT ?? 443);

export type TlsProbe =
  | { kind: "valid"; issuer: string }
  | { kind: "untrusted"; reason: string }
  | { kind: "no-proxy"; reason: string }
  | { kind: "unreachable"; reason: string };

/**
 * Asks our own proxy, over TLS, for the certificate it serves for a hostname.
 *
 * This is the check that actually works. Fetching `https://<domain>` from
 * inside the app container sends the request out to the host's own public
 * address and back again, and a great many hosts do not route that hairpin
 * at all: the site is fine from anywhere on the internet and the container
 * alone cannot reach it. That is a false red light on the one screen whose
 * job is to say whether the address works.
 *
 * A publicly trusted certificate for the name is proof of the thing the
 * round trip was trying to prove. Let's Encrypt only issues one after
 * reaching this server over the public internet on that exact name, so if
 * the proxy is holding a valid one, the outside world got here.
 *
 * The handshake doubles as the trigger: Caddy issues on demand, on the first
 * TLS connection carrying the name as SNI.
 */
export function tlsProbe(hostname: string, timeoutMs = 6000): Promise<TlsProbe> {
  return new Promise((resolve) => {
    let settled = false;
    const done = (result: TlsProbe) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const socket = connect({
      host: PROXY_HOST,
      port: PROXY_PORT,
      servername: hostname,
      // Node checks the name against the certificate itself, so an answer of
      // `authorized` already means valid for this exact hostname.
      rejectUnauthorized: false,
      timeout: timeoutMs,
    });

    socket.on("secureConnect", () => {
      const cert = socket.getPeerCertificate() as PeerCertificate | Record<string, never>;
      const org = (cert as PeerCertificate)?.issuer?.O;
      const issuer = (Array.isArray(org) ? org[0] : org) ?? "unknown";
      if (socket.authorized) return done({ kind: "valid", issuer });
      done({ kind: "untrusted", reason: socket.authorizationError?.message ?? "not trusted yet" });
    });
    socket.on("timeout", () => done({ kind: "unreachable", reason: "timed out" }));
    socket.on("error", (err) => {
      const code = (err as { code?: string }).code ?? "";
      // No proxy of ours at that address: this instance sits behind one the
      // operator runs, so fall back to the round trip.
      if (code === "ENOTFOUND" || code === "ECONNREFUSED" || code === "EAI_AGAIN") {
        return done({ kind: "no-proxy", reason: code });
      }
      done({ kind: "unreachable", reason: err.message });
    });
  });
}

/**
 * Whether the hostname answers over HTTPS with a certificate a browser would
 * accept.
 *
 * Our own proxy is asked first, because it is the only vantage point inside
 * the container that is not subject to hairpin routing. Only when there is
 * no proxy of ours to ask does this fall back to fetching the tracking
 * script over the public address, which is what every instance used to do.
 */
export async function httpsReachable(
  hostname: string,
  fetchFn: typeof fetch = fetch,
  resolve: (h: string) => Promise<string[]> = resolveAuthoritative,
  probe: (h: string) => Promise<TlsProbe> = tlsProbe
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

  const local = await probe(hostname);
  if (local.kind === "valid") {
    return {
      reachable: { ok: true, detail: "Answers" },
      certificate: { ok: true, detail: `Issued by ${local.issuer}` },
    };
  }
  if (local.kind === "untrusted" || local.kind === "unreachable") {
    console.warn(`[checks] tls ${hostname} via ${PROXY_HOST}: ${local.kind}, ${local.reason}`);
    return {
      reachable: { ok: true, detail: "Answers" },
      certificate: { ok: false, detail: "Being set up" },
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
    console.warn(`[checks] https ${hostname}: ${code || (err as Error).message}`);
    if (CERT_CODES.has(code)) {
      return {
        reachable: { ok: true, detail: "Answers" },
        certificate: { ok: false, detail: "Being set up" },
      };
    }
    return {
      reachable: { ok: false, detail: "Nothing answered" },
      certificate: { ok: false, detail: "Being set up" },
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
