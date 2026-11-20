import type { InstalledClientExtensions } from "./types";

// Replaced by builds that extend this app. Keep it empty here: an unset hook
// does nothing. Runs in the browser, so whatever replaces it ships to every
// visitor.
export const installedClient: InstalledClientExtensions = {};
