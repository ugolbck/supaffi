import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // next-auth imports "next/server" without an extension, which Next 16's
    // package.json (no "exports" map) doesn't resolve under plain Node ESM.
    // Vite's own resolver handles it fine, so force these deps through Vite
    // transform instead of native Node module resolution.
    server: {
      deps: {
        inline: ["next-auth", "next"],
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
