import { defineConfig } from "@playwright/test";

// The .test names resolve to the published Caddy port on this machine, in
// this browser only. Certificates come from Caddy's local CA, which the
// browser does not know, hence ignoreHTTPSErrors; the containers themselves
// trust that CA properly (docker-compose.yml).
export default defineConfig({
  testDir: "./tests",
  timeout: 5 * 60_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    ignoreHTTPSErrors: true,
    trace: "retain-on-failure",
    launchOptions: { args: ["--host-resolver-rules=MAP *.test 127.0.0.1"] },
  },
});
