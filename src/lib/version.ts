// What version this instance is running, and whether a newer one exists.
//
// SUPAFFI_VERSION is baked into the image at build time by the release
// workflow, from the git tag. An image built locally, or a stack still built
// from source, reports "dev" and is never told it is out of date: there is no
// honest comparison to make against a build that has no version.
//
// The check is an unauthenticated read of a public GitHub page. Nothing about
// the instance is sent. It is on by default because an instance running a
// version with a known hole has no other way to find out, and off entirely
// when SUPAFFI_UPDATE_CHECK=off.
//
// Nothing here can update anything. The dashboard shows that a release exists
// and gives the operator the command; applying it stays on the server. Doing
// it from the web app would mean handing the app control of Docker on the
// host, which is root, and that is how self-hosted tools get taken over.

const REPO = "ugolbck/supaffi";
const RELEASES_URL = `https://api.github.com/repos/${REPO}/releases/latest`;

export const DEV_VERSION = "dev";

/**
 * Read on every call rather than captured once at import, so a test can set it
 * and so a container that was restarted with a different image reports what it
 * is actually running.
 */
export function installedVersion(): string {
  const raw = process.env.SUPAFFI_VERSION?.trim();
  // Validated, not trusted. A malformed value compares as 0 against every
  // release and would leave a permanent, unclearable update notice on an
  // instance that is perfectly current.
  return raw && /^\d+(\.\d+)*$/.test(raw) ? raw : DEV_VERSION;
}

export function updateCheckEnabled(): boolean {
  return process.env.SUPAFFI_UPDATE_CHECK?.trim().toLowerCase() !== "off";
}

export type Release = {
  version: string;
  url: string;
  /** The release notes carry a "### Security" section, so this one is not optional. */
  security: boolean;
  notes: string;
};

/**
 * Compares two dotted numeric versions. Negative when a is older.
 *
 * Deliberately not a full semver implementation. Every version this compares
 * is one we produced, the release workflow refuses a tag that does not match
 * package.json, and a pre-release suffix would be a new decision rather than
 * something to silently tolerate here.
 */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) => v.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const [x, y] = [parts(a), parts(b)];
  const length = Math.max(x.length, y.length);
  for (let i = 0; i < length; i += 1) {
    const diff = (x[i] ?? 0) - (y[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function parseRelease(payload: unknown): Release | null {
  if (typeof payload !== "object" || payload === null) return null;
  const raw = payload as { tag_name?: unknown; html_url?: unknown; body?: unknown };
  if (typeof raw.tag_name !== "string") return null;

  const version = raw.tag_name.replace(/^v/, "").trim();
  // A tag that is not a version number is not something to compare against.
  if (!/^\d+(\.\d+)*$/.test(version)) return null;

  const notes = typeof raw.body === "string" ? raw.body : "";
  const fallbackUrl = `https://github.com/${REPO}/releases`;
  // This ends up in an href in the dashboard. Anything that is not a page on
  // this repository is not something we put in front of the operator, however
  // it got into the response.
  const url =
    typeof raw.html_url === "string" && raw.html_url.startsWith(`https://github.com/${REPO}/`)
      ? raw.html_url
      : fallbackUrl;
  return {
    version,
    url,
    // Keep a Changelog's heading, which is what the release workflow copies
    // out of CHANGELOG.md. A release that fixes a hole says so, and the
    // dashboard shows that one differently.
    security: /^#{2,3}\s+security\b/im.test(notes),
    notes,
  };
}

// Cached in memory rather than in the database. It is derived, it is cheap to
// re-fetch, and a restart losing it costs one request. Failures are cached
// too, for less long: an instance with no outbound access should not retry on
// every page render, and should not stay silent for six hours either.
const OK_TTL_MS = 6 * 60 * 60 * 1000;
const FAIL_TTL_MS = 30 * 60 * 1000;

type Cached = { release: Release | null; until: number };

const globalForVersion = globalThis as unknown as { supaffiLatestRelease?: Cached };
let cache: Cached | null = globalForVersion.supaffiLatestRelease ?? null;

// One request at a time, shared. Without this, every render that arrives while
// a check is in flight opens its own socket, which on a server that cannot
// reach GitHub means a pile of connections all waiting out the same timeout.
let inFlight: Promise<Release | null> | null = null;

export function resetReleaseCache(): void {
  cache = null;
  inFlight = null;
  delete globalForVersion.supaffiLatestRelease;
}

/**
 * Asks GitHub and updates the cache. Exported so a caller can wait for it when
 * it genuinely wants to; nothing on a render path does.
 */
export function refreshLatestRelease(now: number = Date.now()): Promise<Release | null> {
  if (inFlight) return inFlight;

  inFlight = (async () => {
    let release: Release | null = null;
    let ttl = FAIL_TTL_MS;
    try {
      const response = await fetch(RELEASES_URL, {
        headers: { accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(5000),
      });
      if (response.ok) {
        release = parseRelease(await response.json());
        if (release) ttl = OK_TTL_MS;
      }
    } catch {
      // An instance with no outbound access is a supported way to run this.
      // Not knowing about a release is not an error worth logging on a loop.
    }

    cache = { release, until: now + ttl };
    if (process.env.NODE_ENV !== "production") globalForVersion.supaffiLatestRelease = cache;
    inFlight = null;
    return release;
  })();

  return inFlight;
}

/**
 * The newer release, or null when there is none, the check is off, or this
 * build has no version to compare.
 *
 * Deliberately synchronous. It answers from the cache and, when that is stale,
 * starts a refresh it does not wait for, so the answer appears on the next
 * navigation instead of holding this one. Awaiting the network here would put
 * up to five seconds on every dashboard load on a server with no outbound
 * access, which is a configuration this project supports on purpose.
 */
export function availableUpdate(now: number = Date.now()): Release | null {
  const installed = installedVersion();
  if (!updateCheckEnabled()) return null;
  if (installed === DEV_VERSION) return null;

  if (!cache || now >= cache.until) {
    // Floating, on purpose. A rejection is impossible here (the body catches
    // everything) and the result is read from the cache on a later render.
    void refreshLatestRelease(now);
  }

  const latest = cache?.release;
  if (!latest) return null;
  return compareVersions(latest.version, installed) > 0 ? latest : null;
}
