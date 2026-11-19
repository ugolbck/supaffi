import type { ReactNode } from "react";

// The contract between this app and a build that extends it. Every hook here
// has a default in static.ts or defaults.ts that keeps this app exactly as it
// ships, so nothing changes unless a build replaces installed*.ts.
//
// Bump on any rename, removal, or change of signature or meaning, and say so
// under "Extensions" in CHANGELOG.md. Adding a hook does not bump. Kept on one
// line: builds read it with a regex.
export const EXTENSIONS_API_VERSION = 2;

/**
 * Plain data, readable from anywhere, the proxy and the startup hook included.
 * Nothing here may need an import to compute.
 */
export type StaticExtensions = {
  owners: {
    /**
     * Where a new Owner creates an account. null keeps the first-run setup
     * wizard and its single Owner. A path opens the instance to several
     * Owners: the wizard and its token go away, an empty instance sends
     * visitors here, the login page links to it, and a product's affiliate
     * domain answers not found for it. An empty string counts as null.
     */
    signupPath: string | null;
    /**
     * Where an Owner who forgot their password goes. A path adds a link to it
     * on the login page, and a product's affiliate domain answers not found
     * for it. An empty string counts as null.
     */
    passwordResetPath: string | null;
  };
  instance: {
    /** Whether the Owner sees the running version, update notices and the "This instance" panel. */
    showInfo: boolean;
  };
  domains: {
    /**
     * Whether a product's affiliate domain needs a DNS TXT record proving the
     * Owner controls it. false keeps every domain live as soon as it is saved.
     * true shows the record in the product's subdomain step and settings, and
     * until it is found the domain gets no certificate and serves nothing. A
     * proven domain that is given up is held for its Owner for a while, and an
     * Owner can have only a few domains waiting for proof at once. A domain
     * waiting for proof blocks no one: another Owner's product saving it takes
     * it, leaving the first with no domain, and the first to prove it keeps it.
     */
    requireOwnershipProof: boolean;
    /**
     * Hostnames no product may use, each with every name under it. Matched
     * without case, surrounding space or a trailing dot, and an internationalized
     * name as its punycode; empty entries are ignored. A leading "*." or "." or
     * anything other than a bare hostname fails at startup: an entry already
     * covers the names under it. This Instance's own domain is always refused,
     * whatever is listed here.
     */
    reserved: string[];
  };
  outbound: {
    /**
     * Whether connections this server opens to a host an Owner typed in
     * refuse internal addresses: loopback, private and link-local networks,
     * shared address space, multicast and reserved ranges, in both IP
     * families, and IPv4 carried in IPv6 (mapped, compatible, translated,
     * NAT64 and 6to4 forms). false leaves every address reachable, a
     * mail relay on this machine included. true resolves the name, refuses it
     * when any of its addresses is internal, and connects to an address it
     * checked, so the name cannot change in between. Covers the product's
     * mail server, the tracking check on the product's website, the HTTPS
     * check on its domain and the DNS checks that ask the domain's own
     * nameservers. A refused mail server is shown to the Owner in the test
     * send, and a queued email records the same message as its error. Not
     * supported with an outbound HTTP(S)_PROXY through NODE_USE_ENV_PROXY:
     * the checks connect directly.
     */
    blockPrivateAddresses: boolean;
  };
  mail: {
    /**
     * A mail server every product without its own sends through. null keeps
     * email off for such a product until its Owner connects a server. Set,
     * every product counts as having email on with no setup: emails are
     * queued, the notification switches apply and affiliates can ask for a
     * password link. A product's own server, when it has one, is always used
     * instead, and removing it falls back to this one. Emails go out from
     * `from` with the product's name as the display name, and replies go to
     * the Owner's account email. The Owner's own notifications still go to
     * that address. outbound.blockPrivateAddresses does not apply to this
     * server. Read when an email is queued and when it is sent, so take every
     * value from the server's environment: this module is bundled for the
     * browser too, where that environment is empty.
     */
    platformServer: PlatformMailServer | null;
  };
};

export type PlatformMailServer = {
  host: string;
  /** 465 is TLS from the first byte; any other port upgrades with STARTTLS when offered. */
  port: number;
  user: string;
  password: string;
  /** A bare address, like noreply@example.com. Never the Owner's: the product's name is the display name. */
  from: string;
  /**
   * How many emails one Owner's products may send through this server in any
   * 24 hours, password links included. Past it, further emails stay queued
   * and go out as the count drops, never dropped. Unset means no limit. Keep
   * it generous: an affiliate waiting on a password link waits too.
   */
  dailyLimitPerOwner?: number;
};

/** Server-side hooks. Called from server components and actions only. */
export type SupaffiExtensions = {
  dashboard: {
    /**
     * Called from the dashboard and onboarding layouts after the Owner check.
     * A redirect sends the Owner elsewhere. Navigation only, never an access
     * check: a layout does not run again on client-side navigation between
     * pages it wraps, does not stop the page segment's own server work, and
     * does not run for server actions or API routes (owners.canUse is the
     * access check, and sends a refused Owner here too). It is not told which
     * page is open and the onboarding layout calls it too, so a redirect to a
     * page under /dashboard or /onboarding loops: send the Owner outside both.
     */
    gate(ownerId: string): Promise<{ redirect?: string }>;
    /** Rendered above every dashboard page's content. */
    banner(ownerId: string): Promise<ReactNode>;
  };
  account: {
    /** Extra sections on the account page, after the password form. */
    sections(ownerId: string): Promise<ReactNode[]>;
  };
  owners: {
    /**
     * Whether this Owner may use the dashboard. The access check every Owner
     * page, server action and Owner-only API route runs before any of its
     * own work. Signing out, the account page and its actions skip it on
     * purpose, so a refused Owner can still reach their own account; the
     * dashboard layout around that page then shows no products, counts or
     * banner. On false nothing else is read or changed: the request redirects
     * where dashboard.gate sends this Owner, or answers not found when the
     * gate sends nowhere. A refused server action never returns.
     * currentOwnerId in the core API does not ask it.
     */
    canUse(ownerId: string): Promise<boolean>;
    /**
     * Whether this Owner's products are served to the public. Asked on every
     * request for the tracking script, click tracking, every affiliate page
     * and server action, and the affiliate sign-in, after the product is
     * found; once per request where a request looks the product up more than
     * once. On false the tracking script is empty, click tracking answers not
     * found, the affiliate pages show the program as paused, and their
     * actions and the sign-in change nothing. The payment webhook and the
     * certificate check do not ask it: events are verified and recorded and
     * certificates issued and renewed as always. Neither does the Owner's
     * dashboard (owners.canUse does). A throw fails the request, with no
     * fallback, so answer from state the build already holds.
     */
    serves(ownerId: string): Promise<boolean>;
  };
};

type InstalledGroups<T> = { [K in keyof T]?: Partial<T[K]> };

export type InstalledStaticExtensions = InstalledGroups<StaticExtensions>;
export type InstalledExtensions = InstalledGroups<SupaffiExtensions>;
