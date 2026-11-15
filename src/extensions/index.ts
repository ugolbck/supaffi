import { defaults } from "./defaults";
import { installed } from "./installed";
import { mergeExtensions } from "./merge";
import type { SupaffiExtensions } from "./types";

// Server hooks. A build's installed.ts can import anything, so this is read
// from pages, layouts and actions only, never from src/lib, the proxy or the
// startup hook (eslint refuses those imports).
export const ext: SupaffiExtensions = mergeExtensions(defaults, installed);
