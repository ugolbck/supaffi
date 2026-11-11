import type { SupaffiExtensions } from "./types";

// This app's own behaviour for every server hook: nothing extra.
export const defaults: SupaffiExtensions = {
  dashboard: {
    gate: async () => ({}),
    banner: async () => null,
  },
  account: {
    sections: async () => [],
  },
};
