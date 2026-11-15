import { installedStatic } from "./installed-static";
import { mergeExtensions } from "./merge";
import type { StaticExtensions } from "./types";

// Imports nothing that does work, so the proxy, the startup hook and anything
// under src/lib can read it without pulling a build's server code along.
export const staticDefaults: StaticExtensions = {
  owners: { signupPath: null, passwordResetPath: null },
  instance: { showInfo: true },
  domains: { requireOwnershipProof: false, reserved: [] },
};

const merged = mergeExtensions(staticDefaults, installedStatic);

// An empty path would match no page yet still read as set, so it counts as no
// path at all.
export const staticExt: StaticExtensions = {
  ...merged,
  owners: {
    signupPath: merged.owners.signupPath?.trim() || null,
    passwordResetPath: merged.owners.passwordResetPath?.trim() || null,
  },
  // Compared against stored domains, which are lowercase with no trailing dot.
  domains: {
    ...merged.domains,
    reserved: merged.domains.reserved.map((domain) => domain.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean),
  },
};
