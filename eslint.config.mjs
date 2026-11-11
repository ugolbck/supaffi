import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    // A leading underscore marks a parameter kept only for its position.
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrorsIgnorePattern: "^_" },
      ],
    },
  },
  {
    // A build's installed.ts can import anything, so the server hooks are read
    // from pages, layouts and actions, never from code those builds may call
    // back into, nor from the proxy or the startup hook.
    files: ["src/lib/**", "src/proxy.ts", "src/instrumentation.ts", "src/extensions/static.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        { paths: ["@/extensions", "@/extensions/index", "@/extensions/defaults", "@/extensions/installed", "@/extensions/core-api"] },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".superpowers/**"]),
]);
