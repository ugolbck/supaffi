// What a build installs as static hooks may hold secrets (mail.platformServer
// carries a password), so the browser bundle must never reach them. Walks
// every "use client" module's imports, the ones they import in turn, and
// fails on any that reaches the static hooks. Type-only imports are erased
// and a "use server" module reaches the browser as a reference only, so
// neither is followed.
import { describe, it, expect } from "vitest";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const SRC = path.join(__dirname, "..", "..", "src");
const FORBIDDEN = [path.join(SRC, "extensions", "static.ts"), path.join(SRC, "extensions", "installed-static.ts")];

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    return statSync(full).isDirectory() ? files(full) : /\.tsx?$/.test(name) ? [full] : [];
  });
}

function directive(source: string, name: string): boolean {
  const code = source.replace(/^(\s|\/\/[^\n]*\n|\/\*[\s\S]*?\*\/)*/, "");
  return code.startsWith(`"${name}"`) || code.startsWith(`'${name}'`);
}

/** The source files this one imports for their values. */
export function valueImports(file: string, source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  const specifiers = [
    ...[...code.matchAll(/\b(import|export)(\s+type\b)?[^"';]*?\bfrom\s*(["'])([^"'\n]+)\3/g)].filter((m) => !m[2]).map((m) => m[4]),
    ...[...code.matchAll(/\bimport\s*(["'])([^"'\n]+)\1/g)].map((m) => m[2]),
    ...[...code.matchAll(/\bimport\s*\(\s*(["'])([^"'\n]+)\1/g)].map((m) => m[2]),
  ];
  return specifiers.flatMap((specifier) => {
    const base = specifier.startsWith("@/")
      ? path.join(SRC, specifier.slice(2))
      : specifier.startsWith(".")
        ? path.resolve(path.dirname(file), specifier)
        : null;
    if (!base) return [];
    const found = [base, `${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(
      (candidate) => existsSync(candidate) && statSync(candidate).isFile()
    );
    return found ? [found] : [];
  });
}

/** The chain of imports from `start` to a forbidden module, or null. */
function pathToForbidden(start: string): string[] | null {
  const seen = new Set<string>();
  const walk = (file: string, trail: string[]): string[] | null => {
    if (FORBIDDEN.includes(file)) return [...trail, file];
    if (seen.has(file)) return null;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    if (trail.length > 0 && directive(source, "use server")) return null;
    for (const next of valueImports(file, source)) {
      const found = walk(next, [...trail, file]);
      if (found) return found;
    }
    return null;
  };
  return walk(start, []);
}

describe("the browser bundle", () => {
  it("never reaches the static hooks", () => {
    const clients = files(SRC).filter((file) => directive(readFileSync(file, "utf8"), "use client"));
    expect(clients.length).toBeGreaterThan(10);
    const offenders = clients
      .map(pathToForbidden)
      .filter((chain) => chain !== null)
      .map((chain) => chain.map((file) => path.relative(SRC, file)).join(" -> "));
    expect(offenders, "Read the hook in a server component and pass the value down as a prop.").toEqual([]);
  });

  it("follows value imports and skips type-only ones", () => {
    const file = path.join(SRC, "app", "x.tsx");
    expect(valueImports(file, `import { staticExt } from "@/extensions/static";`)).toEqual([FORBIDDEN[0]]);
    expect(valueImports(file, `import type { X } from "@/extensions/static";`)).toEqual([]);
    expect(valueImports(file, `export { staticExt } from "@/extensions/static";`)).toEqual([FORBIDDEN[0]]);
  });
});
