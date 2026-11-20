import type { InstalledErrorExtensions } from "./types";

// Replaced by builds that extend this app. Keep it empty here: an unset hook
// does nothing. Read by the startup hook, so whatever replaces it is bundled
// for every runtime, Edge included.
export const installedErrors: InstalledErrorExtensions = {};
