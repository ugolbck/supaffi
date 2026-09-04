import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

// Next.js compiles the startup hook for every runtime it targets, Edge
// included, and the bundler follows every static import while doing it. The
// NEXT_RUNTIME guard inside register() runs too late to matter: it stops the
// code from executing on Edge, not from being bundled there.
//
// `@/lib/password` reaches the native Argon2 binding, which has no Edge build,
// and `@/lib/owner` reaches it in turn. A static import of either one from
// this file fails `next build` outright. That happened twice while this
// instrumentation was being written, and both times it was invisible to tsc
// and to the rest of this suite, neither of which builds the app. This test is
// what stands in for the build.
const SOURCE = path.join(__dirname, "..", "src", "instrumentation.ts");
const FORBIDDEN = ["@/lib/owner", "@/lib/password"];

// Comments discuss these modules by name on purpose, and a dynamic import is
// exactly what the file is supposed to use, so neither counts as a violation.
function staticImportsIn(source: string): string[] {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/[^\n]*/g, "")
    .replace(/\bimport\s*\(\s*(["'])(?:(?!\1).)*\1\s*\)/g, "");
  return FORBIDDEN.filter((specifier) =>
    new RegExp(`["']${specifier.replace(/\//g, "\\/")}["']`).test(code)
  );
}

describe("the Edge bundling boundary in src/instrumentation.ts", () => {
  it("keeps the Argon2 binding out of the Edge bundle", () => {
    const found = staticImportsIn(readFileSync(SOURCE, "utf8"));
    expect(
      found,
      `src/instrumentation.ts statically imports ${found.join(" and ")}. ` +
        `Next bundles this file for the Edge runtime, where the Argon2 binding those ` +
        `modules reach does not resolve, so this breaks \`npm run build\`. Use the ` +
        `owner-existence check in @/lib/ownerExists, which imports only the database ` +
        `client, or reach the module through a dynamic import inside the Node-runtime ` +
        `branch.`
    ).toEqual([]);
  });

  it("recognises a static import of the modules it forbids", () => {
    // Guards the detector itself: a regex that matched nothing would pass the
    // test above for the wrong reason, forever.
    expect(staticImportsIn(`import { ownerExists } from "@/lib/owner";`)).toEqual(["@/lib/owner"]);
    expect(staticImportsIn(`import {\n  hashPassword,\n} from "@/lib/password";`)).toEqual([
      "@/lib/password",
    ]);
    expect(staticImportsIn(`export { ownerExists } from "@/lib/owner";`)).toEqual(["@/lib/owner"]);
    expect(staticImportsIn(`const m = await import("@/lib/owner");`)).toEqual([]);
    expect(staticImportsIn(`// this comment names @/lib/password and is not an import`)).toEqual([]);
    // The safe module whose name the forbidden one is a prefix of.
    expect(staticImportsIn(`import { ownerExists } from "@/lib/ownerExists";`)).toEqual([]);
  });
});
