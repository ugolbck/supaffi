import { installedStatic } from "./installed-static";
import { mergeExtensions } from "./merge";
import type { PlatformMailServer, StaticExtensions } from "./types";

// Imports nothing that does work, so the proxy, the startup hook and anything
// under src/lib can read it without pulling a build's server code along.
export const staticDefaults: StaticExtensions = {
  owners: { signupPath: null, passwordResetPath: null },
  instance: { showInfo: true },
  domains: { requireOwnershipProof: false, reserved: [] },
  outbound: { blockPrivateAddresses: false },
  mail: { platformServer: null },
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

/**
 * The platform's mail server as it is sent through: trimmed, `from` in
 * lowercase. A server with no host counts as none. A `from` that is not one
 * bare address, a port out of range or a limit that is not a whole number
 * above zero fails at startup, so a mistyped setting fails loudly instead of
 * sending from the wrong place. In the browser, where the server's
 * environment is empty, it reads as none.
 */
function platformServer(server: PlatformMailServer | null): PlatformMailServer | null {
  const host = server?.host?.trim().toLowerCase();
  if (!server || !host) return null;
  const from = server.from?.trim().toLowerCase() ?? "";
  if (!/^[^\s@<>",;]+@[^\s@<>",;]+\.[^\s@<>",;]+$/.test(from)) throw new Error(`mail.platformServer: "${server.from}" is not one bare address`);
  const port = Number(server.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error(`mail.platformServer: port ${server.port} is out of range`);
  const limit = server.dailyLimitPerOwner;
  if (limit !== undefined && !(Number.isInteger(limit) && limit > 0)) {
    throw new Error(`mail.platformServer: dailyLimitPerOwner ${limit} is not a whole number above zero`);
  }
  return {
    host,
    port,
    user: server.user?.trim() ?? "",
    password: server.password ?? "",
    from,
    ...(limit === undefined ? {} : { dailyLimitPerOwner: limit }),
  };
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
  mail: { platformServer: platformServer(merged.mail.platformServer) },
};
