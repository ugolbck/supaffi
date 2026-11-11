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
    // The commission engine works for every payment provider, so it never
    // reaches into one. A provider's adapter (src/lib/payments/<provider>/)
    // reads its own events and calls the engine; the engine reaches providers
    // only through the registry in src/lib/payments.
    files: ["src/lib/worker/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [{ name: "stripe", message: "Provider code belongs in src/lib/payments/<provider>/." }],
          patterns: [{ group: ["@/lib/payments/*/**", "@/lib/payments/*/"], message: "Use the registry in @/lib/payments, not a provider's module." }],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".superpowers/**"]),
]);
