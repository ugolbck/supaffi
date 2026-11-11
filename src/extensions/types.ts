import type { ReactNode } from "react";

// The contract between this app and a build that extends it. Every hook here
// has a default in static.ts or defaults.ts that keeps this app exactly as it
// ships, so nothing changes unless a build replaces installed*.ts.
//
// Bump on any rename, removal, or change of signature or meaning, and say so
// under "Extensions" in CHANGELOG.md. Adding a hook does not bump. Kept on one
// line: builds read it with a regex.
export const EXTENSIONS_API_VERSION = 1;

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
     * visitors here, and the login page links to it.
     */
    signupPath: string | null;
    /** Where an Owner who forgot their password goes. A path adds a link to it on the login page. */
    passwordResetPath: string | null;
  };
  instance: {
    /** Whether the Owner sees the running version, update notices and the "This instance" panel. */
    showInfo: boolean;
  };
};

/** Server-side hooks. Called from server components and actions only. */
export type SupaffiExtensions = {
  dashboard: {
    /**
     * Runs on every dashboard and onboarding page after the Owner check. A
     * redirect sends the Owner elsewhere. Navigation only, not an access
     * check: server actions and API routes do not run layouts.
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
