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

/**
 * A reserved entry as stored domains are written: the hostname the URL parser
 * makes of it (lowercase, punycode), with no trailing dot. An entry already
 * covers every name under it, so a leading "*." or "." is refused rather than
 * guessed at, as is anything that is not a bare hostname. Refused at startup,
 * so a mistyped list fails loudly instead of reserving nothing.
 */
function reservedHostname(entry: string): string | null {
  const value = entry.trim();
  if (!value) return null;
  let hostname = "";
  if (!/^[*.]|[/:?#@\s]/.test(value)) {
    try {
      hostname = new URL(`http://${value}`).hostname.replace(/\.$/, "");
    } catch {
      hostname = "";
    }
  }
  if (!hostname) throw new Error(`domains.reserved: "${entry}" is not a bare hostname`);
  return hostname;
}

// An empty path would match no page yet still read as set, so it counts as no
// path at all.
export const staticExt: StaticExtensions = {
  ...merged,
  owners: {
    signupPath: merged.owners.signupPath?.trim() || null,
    passwordResetPath: merged.owners.passwordResetPath?.trim() || null,
  },
  domains: {
    ...merged.domains,
    reserved: merged.domains.reserved.map(reservedHostname).filter((domain) => domain !== null),
  },
};
