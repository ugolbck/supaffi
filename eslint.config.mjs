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
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", ".superpowers/**"]),
]);
