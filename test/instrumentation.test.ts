import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Next.js compiles the startup hook for every runtime it targets, Edge
// included, and Turbopack follows every import while doing it, static or
// dynamic: an `await import()` inside the Node-runtime branch is bundled for
// Edge all the same. The NEXT_RUNTIME guard inside register() runs too late to
// matter: it stops the code from executing on Edge, not from being bundled
// there.
//
// `@/lib/password` reaches the native Argon2 binding, which has no Edge build,
// and `@/lib/owner` reaches it in turn. Importing either one from this file
// fails `next build` outright. That happened twice while this instrumentation
// was being written, and both times it was invisible to tsc and to the rest of
// this suite, neither of which builds the app. This test is what stands in for
// the build.
const SOURCE = path.join(__dirname, "..", "src", "instrumentation.ts");
const FORBIDDEN = [
  "@/lib/owner",
  "@/lib/password",
  "@/extensions",
  "@/extensions/installed",
  "@/extensions/defaults",
  "@/extensions/core-api",
];

// Every module specifier the file imports, re-exports or dynamically imports,
// with a relative one rewritten to its "@/" form (the file sits in src/) and
// any "/index" or extension dropped, so "./lib/owner.ts" and "@/lib/owner"
// read the same. Comments are stripped first: they discuss these modules by
// name on purpose.
function importedModules(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const specifiers = [...code.matchAll(/(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(["'])([^"'\n]+)\1/g)].map((m) => m[2]);
  return specifiers.map((specifier) => {
    const aliased = specifier.startsWith(".") ? `@/${path.posix.normalize(`${specifier}`).replace(/^(\.\/)+/, "")}` : specifier;
    return aliased.replace(/\.(ts|tsx|js)$/, "").replace(/\/index$/, "");
  });
}

function forbiddenImportsIn(source: string): string[] {
  const imported = importedModules(source);
  return FORBIDDEN.filter((specifier) => imported.includes(specifier));
}

describe("the Edge bundling boundary in src/instrumentation.ts", () => {
  it("keeps the Argon2 binding out of the Edge bundle", () => {
    const found = forbiddenImportsIn(readFileSync(SOURCE, "utf8"));
    expect(
      found,
      `src/instrumentation.ts imports ${found.join(" and ")}. ` +
        `Next bundles this file for the Edge runtime, where the Argon2 binding those ` +
        `modules reach does not resolve, so this breaks \`npm run build\`. Use the ` +
        `owner-existence check in @/lib/ownerExists, which imports only the database ` +
        `client. A dynamic import does not help: it is bundled for Edge too.`
    ).toEqual([]);
  });

  it("recognises every way of importing the modules it forbids", () => {
    // Guards the detector itself: a regex that matched nothing would pass the
    // test above for the wrong reason, forever.
    expect(forbiddenImportsIn(`import { ownerExists } from "@/lib/owner";`)).toEqual(["@/lib/owner"]);
    expect(forbiddenImportsIn(`import {\n  hashPassword,\n} from "@/lib/password";`)).toEqual([
      "@/lib/password",
    ]);
    expect(forbiddenImportsIn(`export { ownerExists } from "@/lib/owner";`)).toEqual(["@/lib/owner"]);
    expect(forbiddenImportsIn(`import "@/lib/password";`)).toEqual(["@/lib/password"]);
    // Bundled for Edge like any other import.
    expect(forbiddenImportsIn(`const m = await import("@/lib/owner");`)).toEqual(["@/lib/owner"]);
    expect(forbiddenImportsIn(`const { ext } = await import("@/extensions");`)).toEqual(["@/extensions"]);
    expect(forbiddenImportsIn(`await import(\n  "@/extensions/core-api"\n);`)).toEqual(["@/extensions/core-api"]);
    // Relative paths and index files reach the same modules.
    expect(forbiddenImportsIn(`import { ownerExists } from "./lib/owner";`)).toEqual(["@/lib/owner"]);
    expect(forbiddenImportsIn(`await import("./extensions/index");`)).toEqual(["@/extensions"]);
    expect(forbiddenImportsIn(`import { ext } from "@/extensions/index";`)).toEqual(["@/extensions"]);
    expect(forbiddenImportsIn(`// this comment names @/lib/password and is not an import`)).toEqual([]);
    // The safe module whose name the forbidden one is a prefix of.
    expect(forbiddenImportsIn(`import { ownerExists } from "@/lib/ownerExists";`)).toEqual([]);
    expect(forbiddenImportsIn(`await import("@/lib/ownerExists");`)).toEqual([]);
    // Server hooks may pull a build's whole server graph; the static ones are plain data.
    expect(forbiddenImportsIn(`import { staticExt } from "@/extensions/static";`)).toEqual([]);
    expect(forbiddenImportsIn(`await import("@/extensions/static");`)).toEqual([]);
  });
});
