import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const SERVER_EXTENSION_MESSAGE = "Server hooks are read in src/app and passed down. Only @/extensions/static and @/extensions/types are allowed here.";
const SERVER_EXTENSION_MODULES = [
  "@/extensions",
  "@/extensions/index",
  "@/extensions/defaults",
  "@/extensions/installed",
  "@/extensions/core-api",
].map((name) => ({ name, message: SERVER_EXTENSION_MESSAGE }));

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
    // back into, nor from the proxy or the startup hook. The pattern catches
    // the same modules reached by a relative path.
    files: ["src/lib/**", "src/proxy.ts", "src/instrumentation.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SERVER_EXTENSION_MODULES,
          patterns: [{ regex: "^\\.\\.?/(\\.\\./)*extensions(/(index|defaults|installed|core-api))?(\\.tsx?)?$", message: SERVER_EXTENSION_MESSAGE }],
        },
      ],
    },
  },
  {
    // static.ts sits next to those modules, so its relative paths are short.
    files: ["src/extensions/static.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: SERVER_EXTENSION_MODULES,
          patterns: [{ regex: "^\\.(/(index|defaults|installed|core-api)(\\.tsx?)?)?/?$", message: SERVER_EXTENSION_MESSAGE }],
        },
      ],
    },
  },
  {
    // The commission engine works for every payment provider, so it never
    // reaches into one. A provider's adapter (src/lib/payments/<provider>/)
    // reads its own events and calls the engine; the engine reaches providers
    // only through the registry in src/lib/payments. ESLint keeps one set of
    // options per rule, so the extension rule for src/lib is repeated here.
    files: ["src/lib/worker/**"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          paths: [...SERVER_EXTENSION_MODULES, { name: "stripe", message: "Provider code belongs in src/lib/payments/<provider>/." }],
          patterns: [
            { regex: "^\\.\\.?/(\\.\\./)*extensions(/(index|defaults|installed|core-api))?(\\.tsx?)?$", message: SERVER_EXTENSION_MESSAGE },
            {
              group: ["@/lib/payments/*", "@/lib/payments/*/**", "!@/lib/payments/types", "../payments/*", "../payments/*/**", "!../payments/types"],
              message: "Use the registry in @/lib/payments, not a provider's module.",
            },
          ],
        },
      ],
    },
  },
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".superpowers/**"]),
]);
