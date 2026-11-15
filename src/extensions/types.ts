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
};

/** Server-side hooks. Called from server components and actions only. */
export type SupaffiExtensions = {
  dashboard: {
    /**
     * Called from the dashboard and onboarding layouts after the Owner check.
     * A redirect sends the Owner elsewhere. Navigation only, never an access
     * check: a layout does not run again on client-side navigation between
     * pages it wraps, does not stop the page segment's own server work, and
     * does not run for server actions or API routes. It is not told which page
     * is open and the onboarding layout calls it too, so a redirect to a page
     * under /dashboard or /onboarding loops: send the Owner outside both.
     */
    gate(ownerId: string): Promise<{ redirect?: string }>;
    /** Rendered above every dashboard page's content. */
    banner(ownerId: string): Promise<ReactNode>;
  };
  account: {
    /** Extra sections on the account page, after the password form. */
    sections(ownerId: string): Promise<ReactNode[]>;
  };
};

type InstalledGroups<T> = { [K in keyof T]?: Partial<T[K]> };

export type InstalledStaticExtensions = InstalledGroups<StaticExtensions>;
export type InstalledExtensions = InstalledGroups<SupaffiExtensions>;
