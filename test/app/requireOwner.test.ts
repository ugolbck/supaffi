// Every Owner page, layout, route handler and server action runs requireOwner
// before its own work, so owners.canUse is checked on every way in. A layout
// does not guard what it wraps (it does not run for server actions or route
// handlers, and does not stop a page's own work), so each one carries the call
// itself, directly or through a function of its own that makes it.
//
// Read from the source rather than run, so a new action or page that skips the
// guard fails here before anyone thinks to write a test for it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const APP = path.join(__dirname, "..", "..", "src", "app");

// Where every entry point belongs to an Owner.
const OWNER_AREAS = ["dashboard/", "onboarding/"];

// Open to an Owner refused by owners.canUse. Each still checks the session,
// through requireOwnerSession, except signing out, which needs no session.
const SESSION_ONLY: Record<string, string> = {
  "dashboard/layout.tsx": "wraps the account page",
  "onboarding/layout.tsx": "navigation only, like the dashboard layout",
  "dashboard/account/page.tsx": "the account page",
  "dashboard/account/accountActions.ts": "email and password changes",
};
const NO_SESSION = ["dashboard/signOutAction.ts"];

const GUARD = "requireOwner.ts#requireOwner";
const CONVENTION = /(^|\/)(page|layout|route|template|default)\.tsx?$/;

type Fn = ts.FunctionLikeDeclaration | ts.Expression;
type Unit = {
  sf: ts.SourceFile;
  imports: Map<string, string>;
  decls: Map<string, ts.Node>;
};

function isDirective(statement: ts.Statement | undefined, text: string): boolean {
  return (
    !!statement &&
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === text
  );
}

function hasExport(node: ts.Node): boolean {
  return (ts.getCombinedModifierFlags(node as ts.Declaration) & ts.ModifierFlags.Export) !== 0;
}

/** Every bare function name called anywhere under node. */
function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

function resolve(spec: string, from: string, files: Record<string, string>): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = path.posix.relative("app", spec.slice(2));
  else if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  if (target.startsWith("..")) return null;
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    if (candidate in files) return candidate;
  }
  return null;
}

function parse(file: string, source: string, files: Record<string, string>): Unit {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const imports = new Map<string, string>();
  const decls = new Map<string, ts.Node>();
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolve(statement.moduleSpecifier.text, file, files);
      const named = statement.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const el of named.elements) imports.set(el.name.text, `${target}#${(el.propertyName ?? el.name).text}`);
      }
    } else if (ts.isFunctionDeclaration(statement) && statement.name) {
      decls.set(statement.name.text, statement);
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (ts.isIdentifier(d.name) && d.initializer) decls.set(d.name.text, d.initializer);
      }
    }
  }
  return { sf, imports, decls };
}

/** The functions a request can reach directly: exported from a route file or a server action file, or marked "use server" inline. */
function entryPoints(file: string, unit: Unit): { name: string; node: Fn }[] {
  const entries: { name: string; node: Fn }[] = [];
  const exported = CONVENTION.test(file) || isDirective(unit.sf.statements[0], "use server");
  for (const statement of unit.sf.statements) {
    if (!exported) break;
    if (ts.isFunctionDeclaration(statement) && hasExport(statement)) {
      entries.push({ name: statement.name?.text ?? "default", node: statement });
    } else if (ts.isVariableStatement(statement) && hasExport(statement)) {
      for (const d of statement.declarationList.declarations) {
        const init = d.initializer;
        if (init && (ts.isArrowFunction(init) || ts.isFunctionExpression(init) || ts.isCallExpression(init))) {
          entries.push({ name: d.name.getText(), node: init });
        }
      }
    } else if (ts.isExportAssignment(statement)) {
      const target = ts.isIdentifier(statement.expression) ? unit.decls.get(statement.expression.text) : statement.expression;
      if (target) entries.push({ name: "default", node: target as Fn });
    }
  }
  const visit = (n: ts.Node) => {
    if (ts.isFunctionLike(n) && "body" in n && n.body && ts.isBlock(n.body) && isDirective(n.body.statements[0], "use server")) {
      entries.push({ name: n.name?.getText() ?? "inline action", node: n as ts.FunctionLikeDeclaration });
    }
    ts.forEachChild(n, visit);
  };
  if (!isDirective(unit.sf.statements[0], "use server")) visit(unit.sf);
  return entries;
}

/** Entry points in the Owner areas that never reach requireOwner, as "file#name". */
function unguarded(files: Record<string, string>): string[] {
  const units = Object.fromEntries(Object.entries(files).map(([file, source]) => [file, parse(file, source, files)]));
  const resolveName = (file: string, name: string) =>
    units[file].decls.has(name) ? `${file}#${name}` : units[file].imports.get(name);
  const reachesGuard = (file: string, node: ts.Node, guarded: Set<string>) =>
    [...calledNames(node)].some((name) => {
      const key = resolveName(file, name);
      return key !== undefined && guarded.has(key);
    });

  // A function that calls requireOwner, or calls one that does, guards too.
  const guarded = new Set([GUARD]);
  for (let grew = true; grew; ) {
    grew = false;
    for (const [file, unit] of Object.entries(units)) {
      for (const [name, node] of unit.decls) {
        const key = `${file}#${name}`;
        if (!guarded.has(key) && reachesGuard(file, node, guarded)) {
          guarded.add(key);
          grew = true;
        }
      }
    }
  }

  const missing: string[] = [];
  for (const [file, unit] of Object.entries(units)) {
    if (!OWNER_AREAS.some((area) => file.startsWith(area))) continue;
    if (file in SESSION_ONLY || NO_SESSION.includes(file)) continue;
    // Imports nothing but redirect and friends, so it can do no work of its
    // own: it sends the Owner to a page that checks.
    const specifiers = unit.sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
    if (specifiers.length > 0 && specifiers.every((s) => s === "next/navigation")) continue;
    for (const entry of entryPoints(file, unit)) {
      if (!reachesGuard(file, entry.node, guarded)) missing.push(`${file}#${entry.name}`);
    }
  }
  return missing;
}

function appFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(APP, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(APP, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return files;
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("the Owner guard", () => {
  const files = appFiles();

  it("runs on every Owner page, layout, route handler and server action", () => {
    const missing = unguarded(files);
    expect(
      missing,
      `These reach Owner data without requireOwner from @/app/requireOwner: ${missing.join(", ")}. ` +
        `Call it first, before any read or write. Only the account page, its actions and the layouts ` +
        `skip it, through requireOwnerSession.`
    ).toEqual([]);
  });

  it("is the only Owner session check in the app", () => {
    const checks = Object.entries(files)
      .filter(([file]) => file !== "requireOwner.ts")
      .filter(([, source]) => /role\s*[!=]==?\s*["']owner["']|["']owner["']\s*[!=]==?\s*[\w.?]*role\b/.test(withoutComments(source)))
      .map(([file]) => file);
    expect(checks, `Check an Owner with requireOwner from @/app/requireOwner instead: ${checks.join(", ")}`).toEqual([]);

    const sessionReads = Object.entries(files)
      .filter(([file]) => OWNER_AREAS.some((area) => file.startsWith(area)))
      .filter(([, source]) => /import\s*\{[^}]*\bauth\b[^}]*\}\s*from\s*["']@\/lib\/auth["']/.test(source))
      .map(([file]) => file);
    expect(sessionReads, `Read the Owner through @/app/requireOwner instead: ${sessionReads.join(", ")}`).toEqual([]);
  });

  it("is skipped only where the session alone is checked", () => {
    for (const file of Object.keys(SESSION_ONLY)) {
      expect(calledNames(parse(file, files[file], files).sf).has("requireOwnerSession"), file).toBe(true);
    }
    for (const file of NO_SESSION) expect(files[file], file).toBeDefined();
  });

  it("finds an entry point that skips it", () => {
    // Guards the detector itself: one that found nothing would pass the scan
    // above for the wrong reason, forever.
    const guard = `export async function requireOwner() {}`;
    const scan = (more: Record<string, string>) => unguarded({ "requireOwner.ts": guard, ...more });
    const action = (body: string) => `"use server";\nimport { requireOwner } from "@/app/requireOwner";\n${body}`;

    expect(scan({ "dashboard/a.ts": action(`export async function save() { await requireOwner(); }`) })).toEqual([]);
    expect(scan({ "dashboard/a.ts": action(`export async function save() { await write(); }`) })).toEqual(["dashboard/a.ts#save"]);
    expect(scan({ "dashboard/a.ts": action(`export const save = async () => { await write(); };`) })).toEqual(["dashboard/a.ts#save"]);
    // Through a helper in the same file, or one imported from another.
    expect(
      scan({ "dashboard/a.ts": action(`async function owner() { return requireOwner(); }\nexport async function save() { await owner(); }`) })
    ).toEqual([]);
    expect(
      scan({
        "onboarding/checks.ts": `import { cache } from "react";\nimport { requireOwner } from "../requireOwner";\nexport const load = cache(async () => requireOwner());`,
        "onboarding/page.tsx": `import { load } from "./checks";\nexport default async function Page() { await load(); }`,
      })
    ).toEqual([]);
    // A helper of the same name elsewhere does not count.
    expect(
      scan({
        "dashboard/b.ts": action(`export async function owner() { return requireOwner(); }`),
        "dashboard/a.ts": `"use server";\nasync function owner() { return 1; }\nexport async function save() { await owner(); }`,
      })
    ).toEqual(["dashboard/a.ts#save"]);
    // Pages, route handlers and inline actions.
    expect(scan({ "dashboard/x/page.tsx": `import { db } from "@/lib/db";\nexport default async function Page() {}` })).toEqual([
      "dashboard/x/page.tsx#Page",
    ]);
    expect(scan({ "dashboard/x/route.ts": `import { db } from "@/lib/db";\nexport async function GET() {}` })).toEqual([
      "dashboard/x/route.ts#GET",
    ]);
    expect(
      scan({
        "dashboard/x/page.tsx": `import { requireOwner } from "@/app/requireOwner";\nexport default async function Page() {\n  await requireOwner();\n  async function go() { "use server"; await write(); }\n}`,
      })
    ).toEqual(["dashboard/x/page.tsx#go"]);
    // A page that can only redirect.
    expect(scan({ "dashboard/x/page.tsx": `import { redirect } from "next/navigation";\nexport default function Page() { redirect("/"); }` })).toEqual(
      []
    );
    // Outside the Owner areas.
    expect(scan({ "affiliates/a.ts": `"use server";\nexport async function save() {}` })).toEqual([]);
  });
});
