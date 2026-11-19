import { lookup } from "node:dns/promises";
import http from "node:http";
import https from "node:https";
import { BlockList, isIP, type LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { staticExt } from "@/extensions/static";

// Connections this server opens to a host an Owner typed in: their mail
// server, their website, their product's domain. With
// staticExt.outbound.blockPrivateAddresses set, none of them may reach this
// server's own network. Off by default, and then nothing here runs.

const INTERNAL = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  INTERNAL.addSubnet(network, prefix, "ipv4");
}
INTERNAL.addAddress("255.255.255.255", "ipv4");
INTERNAL.addAddress("::", "ipv6");
INTERNAL.addAddress("::1", "ipv6");
INTERNAL.addSubnet("fc00::", 7, "ipv6");
INTERNAL.addSubnet("fe80::", 10, "ipv6");
INTERNAL.addSubnet("ff00::", 8, "ipv6");
// 6to4 and local-use NAT64 can carry any IPv4 address, internal ones included.
INTERNAL.addSubnet("2002::", 16, "ipv6");
INTERNAL.addSubnet("64:ff9b:1::", 48, "ipv6");

export function blocksPrivateAddresses(): boolean {
  return staticExt.outbound.blockPrivateAddresses;
}

/** Thrown for a host with an internal address. Coded like a server that cannot be reached. */
export class PrivateAddressError extends Error {
  readonly code = "ECONNECTION";
  constructor(host: string) {
    super(`${host} is on a private network`);
    this.name = "PrivateAddressError";
  }
}

/** The eight 16-bit groups of an IPv6 address, a trailing dotted quad included. */
function ipv6Groups(address: string): number[] | null {
  let text = address.toLowerCase();
  const quad = text.match(/(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (quad) {
    const [a, b, c, d] = quad.slice(1).map(Number);
    text = `${text.slice(0, -quad[0].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const halves = text.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const fill = halves.length === 2 ? 8 - head.length - tail.length : 0;
  const groups = [...head, ...Array<string>(Math.max(fill, 0)).fill("0"), ...tail].map((group) => parseInt(group, 16));
  return groups.length === 8 && groups.every((group) => group >= 0 && group <= 0xffff) ? groups : null;
}

// The first six groups of each form that ends in an IPv4 address: compatible
// (::a.b.c.d), mapped (::ffff:a.b.c.d), translated (::ffff:0:a.b.c.d) and the
// well-known NAT64 prefix (64:ff9b::a.b.c.d).
const IPV4_PREFIXES = [
  [0, 0, 0, 0, 0, 0],
  [0, 0, 0, 0, 0, 0xffff],
  [0, 0, 0, 0, 0xffff, 0],
  [0x64, 0xff9b, 0, 0, 0, 0],
];

/** The IPv4 address inside an IPv6 address of a form that embeds one. */
function embeddedIPv4(address: string): string | null {
  const groups = ipv6Groups(address);
  if (!groups || !IPV4_PREFIXES.some((prefix) => prefix.every((group, i) => groups[i] === group))) return null;
  return [groups[6] >> 8, groups[6] & 0xff, groups[7] >> 8, groups[7] & 0xff].join(".");
}

/** Whether an address is loopback, private, link-local or otherwise not on the internet. Anything that is not an address counts. */
export function isInternalAddress(address: string): boolean {
  const bare = address.replace(/^\[|\]$/g, "").split("%")[0];
  const family = isIP(bare);
  if (family === 4) return INTERNAL.check(bare, "ipv4");
  if (family !== 6) return true;
  const v4 = embeddedIPv4(bare);
  return INTERNAL.check(bare, "ipv6") || (v4 !== null && INTERNAL.check(v4, "ipv4"));
}

async function lookupAll(host: string): Promise<string[]> {
  return (await lookup(host, { all: true, verbatim: true })).map(({ address }) => address);
}

/**
 * Every address of a host once all of them are public, an IP literal as
 * itself. A name that does not resolve fails coded like nodemailer's own DNS
 * failure; one with any internal address throws PrivateAddressError.
 */
export async function publicAddresses(
  host: string,
  resolve: (host: string) => Promise<string[]> = lookupAll
): Promise<string[]> {
  const literal = host.replace(/^\[|\]$/g, "");
  let addresses: string[];
  if (isIP(literal)) {
    addresses = [literal];
  } else {
    try {
      addresses = await resolve(host);
    } catch (err) {
      throw Object.assign(new Error(`Could not resolve ${host}`), { code: "EDNS", cause: err });
    }
    if (addresses.length === 0) throw Object.assign(new Error(`Could not resolve ${host}`), { code: "EDNS" });
  }
  if (addresses.some(isInternalAddress)) throw new PrivateAddressError(host);
  return addresses;
}

/**
 * A lookup for node:net and node:http that answers only for public hosts.
 * The socket connects to the address checked here, so the name cannot point
 * somewhere else between the check and the connection.
 */
export const publicLookup = ((hostname: string, options: { all?: boolean; family?: number | string }, callback: (...args: unknown[]) => void) => {
  publicAddresses(hostname).then(
    (all) => {
      const wanted = options.family === 4 || options.family === "IPv4" ? 4 : options.family === 6 || options.family === "IPv6" ? 6 : 0;
      const addresses = wanted ? all.filter((address) => isIP(address) === wanted) : all;
      if (addresses.length === 0) return callback(Object.assign(new Error(`No address for ${hostname}`), { code: "ENOTFOUND" }));
      if (options.all) return callback(null, addresses.map((address) => ({ address, family: isIP(address) })));
      callback(null, addresses[0], isIP(addresses[0]));
    },
    (err) => callback(err)
  );
}) as unknown as LookupFunction;

function fetchFailed(cause: unknown): TypeError {
  return new TypeError("fetch failed", { cause });
}

const NULL_BODY = new Set([101, 204, 205, 304]);

function requestOnce(url: URL, init: RequestInit): Promise<Response> {
  if (url.protocol !== "http:" && url.protocol !== "https:") return Promise.reject(fetchFailed(new Error("Only http and https")));
  const literal = url.hostname.replace(/^\[|\]$/g, "");
  if (isIP(literal) && isInternalAddress(literal)) return Promise.reject(fetchFailed(new PrivateAddressError(url.hostname)));
  const method = (init.method ?? "GET").toUpperCase();
  return new Promise((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).request(
      url,
      {
        method,
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
        lookup: publicLookup,
      },
      (response) => {
        const status = response.statusCode ?? 0;
        if (status < 200 || status > 599) {
          response.destroy();
          return reject(fetchFailed(new Error(`Status ${status}`)));
        }
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers)) {
          for (const one of Array.isArray(value) ? value : value === undefined ? [] : [value]) headers.append(name, one);
        }
        const empty = method === "HEAD" || NULL_BODY.has(status);
        if (empty) response.resume();
        const body = empty ? null : (Readable.toWeb(response) as ReadableStream<Uint8Array>);
        resolve(new Response(body, { status, statusText: response.statusMessage, headers }));
      }
    );
    request.on("error", (err) => reject(fetchFailed(err)));
    request.end();
  });
}

const MAX_REDIRECTS = 20;

/**
 * fetch for a URL an Owner typed in, refusing internal addresses on every
 * hop. Covers what this app's checks use: GET and HEAD, redirects followed
 * or left alone, a timeout signal. The body is passed through undecoded, and
 * nothing asks for it compressed.
 */
export const publicFetch = (async (input: string | URL | Request, init: RequestInit = {}) => {
  let url = new URL(input instanceof Request ? input.url : input);
  for (let hops = 0; ; hops++) {
    const response = await requestOnce(url, init);
    const location = response.headers.get("location");
    if (init.redirect === "manual" || response.status < 300 || response.status > 399 || !location) return response;
    await response.body?.cancel();
    if (hops >= MAX_REDIRECTS) throw fetchFailed(new Error("Too many redirects"));
    url = new URL(location, url);
  }
}) as typeof fetch;

/** The fetch to reach a host an Owner typed in with: the plain one unless private addresses are blocked. */
export function outboundFetch(): typeof fetch {
  return blocksPrivateAddresses() ? publicFetch : fetch;
}
