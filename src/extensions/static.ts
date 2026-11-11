import { installedStatic } from "./installed-static";
import { mergeExtensions } from "./merge";
import type { StaticExtensions } from "./types";

// Imports nothing that does work, so the proxy, the startup hook and anything
// under src/lib can read it without pulling a build's server code along.
export const staticDefaults: StaticExtensions = {
  owners: { signupPath: null },
  instance: { showInfo: true },
};

export const staticExt: StaticExtensions = mergeExtensions(staticDefaults, installedStatic);
