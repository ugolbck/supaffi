import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    // Test files that hit the live Postgres DB (test/lib/owner.test.ts,
    // test/lib/merchant.test.ts, ...) share tables and each clear them in
    // beforeEach/afterAll. Running test files in parallel workers races
    // those against each other (FK violations, "Owner already exists").
    // Run files sequentially in one process instead.
    fileParallelism: false,
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
