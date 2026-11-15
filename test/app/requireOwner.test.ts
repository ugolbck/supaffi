// Every Owner page, layout, route handler and server action runs requireOwner
// as the first thing it awaits, so owners.canUse is checked on every way in
// before any read or write. A layout does not guard what it wraps (it does not
// run for server actions or route handlers, and does not stop a page's own
// work), so each one carries the call itself, directly or through a function
// of its own whose first await makes it.
//
// Read from the source rather than run, so a new action or page that skips the
// guard fails here before anyone thinks to write a test for it.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.join(__dirname, "..", "..", "src");

// Where every entry point belongs to an Owner.
const OWNER_AREAS = ["app/dashboard/", "app/onboarding/"];

// Open to an Owner refused by owners.canUse, so a refused Owner can still
// reach their own account. Each still checks the session first, through
// requireOwnerSession; signing out needs no session.
const SESSION_ONLY: Record<string, string> = {
  "app/dashboard/layout.tsx": "wraps the account page",
  "app/onboarding/layout.tsx": "navigation only, like the dashboard layout",
  "app/dashboard/account/page.tsx": "the account page",
  "app/dashboard/account/accountActions.ts": "email and password changes",
};
const NO_SESSION = ["app/dashboard/signOutAction.ts"];

// What a session-only layout may await before asking owners.canUse.
const LAYOUT_BEFORE_CAN_USE = ["ext.dashboard.gate"];

// Owner role checks outside the guard, each on purpose.
const ROLE_CHECKS: Record<string, string> = {
  "app/requireOwner.ts": "the guard itself",
  "extensions/core-api.ts": "currentOwnerId, which a page outside the dashboard needs for a refused Owner",
  "lib/sessionGuard.ts": "drops a stale session before any guard sees it",
};

const GUARD = "app/requireOwner.ts#requireOwner";
const SESSION_GUARD = "app/requireOwner.ts#requireOwnerSession";
const CAN_USE = "app/requireOwner.ts#ownerCanUse";
const CONVENTION =
  /(^|\/)(page|layout|route|template|default|not-found|error|icon|apple-icon|opengraph-image|twitter-image|sitemap|robots|manifest)\.tsx?$/;

type Unit = {
  sf: ts.SourceFile;
  /** Local name to "file#name" of what it imports. */
  imports: Map<string, string>;
  /** Top-level functions and variables, by local name. */
  decls: Map<string, ts.Node>;
  /** Exported name to a local name, or to "file#name" for a re-export. */
  exports: Map<string, { local: string } | { key: string }>;
  /** Files whose every export this one re-exports. */
  stars: string[];
};

function isDirective(statement: ts.Statement | undefined, text: string): boolean {
  return (
    !!statement &&
    ts.isExpressionStatement(statement) &&
    ts.isStringLiteral(statement.expression) &&
    statement.expression.text === text
  );
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

function isFunction(node: ts.Node): node is ts.FunctionLikeDeclaration {
  return ts.isFunctionDeclaration(node) || ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isMethodDeclaration(node);
}

/** The function a declaration runs: itself, or the one it hands to a wrapper such as cache(). */
function runs(node: ts.Node): ts.Node | null {
  if (isFunction(node)) return node;
  if (ts.isCallExpression(node)) {
    for (const arg of node.arguments) {
      const inner = runs(arg);
      if (inner) return inner;
    }
  }
  return null;
}

/**
 * What each awaited call in a function calls, in the order they run, nested
 * functions left out. A returned call counts: the function waits on it there.
 */
function awaitedCalls(fn: ts.Node): string[] {
  const calls: string[] = [];
  const awaited = (n: ts.Node) =>
    (ts.isAwaitExpression(n) || ts.isReturnStatement(n)) && n.expression && ts.isCallExpression(n.expression)
      ? n.expression
      : null;
  const visit = (n: ts.Node) => {
    if (n !== fn && isFunction(n)) return;
    ts.forEachChild(n, visit);
    // After the children: an await's arguments run before the call itself.
    const call = awaited(n);
    if (call) calls.push(call.expression.getText());
  };
  visit(fn);
  if (isFunction(fn) && fn.body && ts.isCallExpression(fn.body)) calls.push(fn.body.expression.getText());
  return calls;
}

function calledNames(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

function resolveModule(spec: string, from: string, files: Record<string, string>): string | null {
  let target: string;
  if (spec.startsWith("@/")) target = spec.slice(2);
  else if (spec.startsWith(".")) target = path.posix.normalize(path.posix.join(path.posix.dirname(from), spec));
  else return null;
  for (const candidate of [target, `${target}.ts`, `${target}.tsx`, `${target}/index.ts`, `${target}/index.tsx`]) {
    if (candidate in files) return candidate;
  }
  return null;
}

function parse(file: string, source: string, files: Record<string, string>): Unit {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const unit: Unit = { sf, imports: new Map(), decls: new Map(), exports: new Map(), stars: [] };
  const exported = (node: ts.Node) => hasModifier(node, ts.SyntaxKind.ExportKeyword);
  for (const statement of sf.statements) {
    if (ts.isImportDeclaration(statement) && ts.isStringLiteral(statement.moduleSpecifier)) {
      const target = resolveModule(statement.moduleSpecifier.text, file, files);
      const named = statement.importClause?.namedBindings;
      if (target && named && ts.isNamedImports(named)) {
        for (const el of named.elements) unit.imports.set(el.name.text, `${target}#${(el.propertyName ?? el.name).text}`);
      }
    } else if (ts.isExportDeclaration(statement)) {
      const target =
        statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier)
          ? resolveModule(statement.moduleSpecifier.text, file, files)
          : null;
      const clause = statement.exportClause;
      if (!clause) {
        if (target) unit.stars.push(target);
      } else if (ts.isNamedExports(clause)) {
        for (const el of clause.elements) {
          const local = (el.propertyName ?? el.name).text;
          unit.exports.set(el.name.text, statement.moduleSpecifier ? { key: `${target}#${local}` } : { local });
        }
      }
    } else if (ts.isFunctionDeclaration(statement)) {
      const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
      const name = statement.name?.text ?? "default";
      unit.decls.set(name, statement);
      if (exported(statement)) unit.exports.set(isDefault ? "default" : name, { local: name });
    } else if (ts.isVariableStatement(statement)) {
      for (const d of statement.declarationList.declarations) {
        if (!ts.isIdentifier(d.name) || !d.initializer) continue;
        unit.decls.set(d.name.text, d.initializer);
        if (exported(statement)) unit.exports.set(d.name.text, { local: d.name.text });
      }
    } else if (ts.isExportAssignment(statement)) {
      if (ts.isIdentifier(statement.expression)) unit.exports.set("default", { local: statement.expression.text });
      else {
        unit.decls.set("default", statement.expression);
        unit.exports.set("default", { local: "default" });
      }
    }
  }
  return unit;
}

/** Owner entry points that do not await the guard first, as "file#name". */
function unguarded(files: Record<string, string>): string[] {
  const units: Record<string, Unit> = Object.fromEntries(
    Object.entries(files).map(([file, source]) => [file, parse(file, source, files)])
  );

  // The declaration an exported name ends up at, through re-exports.
  const exportKey = (file: string, name: string, seen = new Set<string>()): string | undefined => {
    const unit = units[file];
    if (!unit || seen.has(`${file}#${name}`)) return undefined;
    seen.add(`${file}#${name}`);
    const entry = unit.exports.get(name);
    if (entry) {
      if ("local" in entry) return localKey(file, entry.local, seen);
      const [target, imported] = entry.key.split("#");
      return exportKey(target, imported, seen) ?? entry.key;
    }
    for (const star of unit.stars) {
      const found = exportKey(star, name, seen);
      if (found) return found;
    }
    return undefined;
  };
  const localKey = (file: string, name: string, seen = new Set<string>()): string | undefined => {
    const unit = units[file];
    if (unit.decls.has(name)) return `${file}#${name}`;
    const imported = unit.imports.get(name);
    if (!imported) return undefined;
    const [target, exportedName] = imported.split("#");
    return exportKey(target, exportedName, seen) ?? imported;
  };
  const firstAwait = (file: string, fn: ts.Node) => {
    const [first] = awaitedCalls(fn);
    return first === undefined ? undefined : localKey(file, first);
  };

  // Everything whose first await is the given function, or one of these.
  const guardedBy = (base: string) => {
    const set = new Set([base]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const [file, unit] of Object.entries(units)) {
        for (const [name, node] of unit.decls) {
          const fn = runs(node);
          const key = `${file}#${name}`;
          if (!fn || set.has(key)) continue;
          const first = firstAwait(file, fn);
          if (first && set.has(first)) {
            set.add(key);
            grew = true;
          }
        }
      }
    }
    return set;
  };
  const guarded = guardedBy(GUARD);
  const sessionGuarded = guardedBy(SESSION_GUARD);

  const missing: string[] = [];
  for (const [file, unit] of Object.entries(units)) {
    if (!OWNER_AREAS.some((area) => file.startsWith(area))) continue;
    if (NO_SESSION.includes(file)) continue;
    // Imports nothing but redirect and friends, so it can do no work of its
    // own: it sends the Owner to a page that checks.
    const specifiers = unit.sf.statements.filter(ts.isImportDeclaration).map((d) => (d.moduleSpecifier as ts.StringLiteral).text);
    if (specifiers.length > 0 && specifiers.every((s) => s === "next/navigation")) continue;

    const sessionOnly = file in SESSION_ONLY;
    const accepted = (key: string | undefined) =>
      key !== undefined && (guarded.has(key) || (sessionOnly && sessionGuarded.has(key)));

    const entries: { name: string; key?: string; fn: ts.Node }[] = [];
    if (CONVENTION.test(file) || isDirective(unit.sf.statements[0], "use server")) {
      const names = new Set([...unit.exports.keys(), ...unit.stars.flatMap((star) => [...(units[star]?.exports.keys() ?? [])])]);
      for (const name of names) {
        const key = exportKey(file, name);
        if (!key) continue;
        const [target, local] = key.split("#");
        const node = units[target]?.decls.get(local);
        const fn = node && runs(node);
        if (fn) entries.push({ name, key, fn });
      }
    }
    // Server actions written inline, inside a page or a component.
    const visit = (n: ts.Node) => {
      if (isFunction(n) && n.body && ts.isBlock(n.body) && isDirective(n.body.statements[0], "use server")) {
        entries.push({ name: n.name?.getText() ?? "inline action", fn: n });
      }
      ts.forEachChild(n, visit);
    };
    if (!isDirective(unit.sf.statements[0], "use server")) visit(unit.sf);

    for (const entry of entries) {
      const [target] = (entry.key ?? file).split("#");
      if (!accepted(entry.key) && !accepted(firstAwait(target, entry.fn))) {
        missing.push(`${file}#${entry.name}`);
        continue;
      }
      // A session-only layout leaves the Owner's data alone until it has
      // asked owners.canUse.
      if (sessionOnly && /(^|\/)layout\.tsx?$/.test(file)) {
        const [, ...rest] = awaitedCalls(entry.fn);
        const canUseAt = rest.findIndex((call) => localKey(target, call) === CAN_USE);
        const before = canUseAt === -1 ? rest : rest.slice(0, canUseAt);
        if (before.some((call) => !LAYOUT_BEFORE_CAN_USE.includes(call))) missing.push(`${file}#${entry.name} (reads before owners.canUse)`);
      }
    }
  }
  return missing;
}

/** Files comparing a session role to the Owner's, however written. */
function roleChecks(file: string, source: string): boolean {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const isRole = (n: ts.Node) => /\brole\b/i.test(n.getText());
  const isOwner = (n: ts.Node) => /["'`]owner["'`]/.test(n.getText());
  let found = false;
  const visit = (n: ts.Node) => {
    if (ts.isBinaryExpression(n)) {
      const op = n.operatorToken.kind;
      const equality = [
        ts.SyntaxKind.EqualsEqualsToken,
        ts.SyntaxKind.EqualsEqualsEqualsToken,
        ts.SyntaxKind.ExclamationEqualsToken,
        ts.SyntaxKind.ExclamationEqualsEqualsToken,
      ].includes(op);
      if (equality && ((isRole(n.left) && isOwner(n.right)) || (isOwner(n.left) && isRole(n.right)))) found = true;
    }
    if (ts.isCallExpression(n) && ts.isPropertyAccessExpression(n.expression)) {
      const method = n.expression.name.text;
      if (["includes", "indexOf", "has", "some", "find"].includes(method) && isRole(n) && isOwner(n)) found = true;
    }
    if (ts.isSwitchStatement(n) && isRole(n.expression) && n.caseBlock.clauses.some((c) => ts.isCaseClause(c) && isOwner(c.expression))) {
      found = true;
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return found;
}

function srcFiles(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(SRC, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.tsx?$/.test(entry.name)) continue;
    const full = path.join(entry.parentPath, entry.name);
    files[path.relative(SRC, full).split(path.sep).join("/")] = readFileSync(full, "utf8");
  }
  return files;
}

describe("the Owner guard", () => {
  const files = srcFiles();

  it("runs first on every Owner page, layout, route handler and server action", () => {
    const missing = unguarded(files);
    expect(
      missing,
      `These reach Owner data without awaiting requireOwner from @/app/requireOwner first: ${missing.join(", ")}. ` +
        `Await it before anything else. Only the account page, its actions and the layouts use ` +
        `requireOwnerSession instead, and a layout reads nothing of the Owner's before ownerCanUse.`
    ).toEqual([]);
  });

  it("is the only Owner session check in the source, besides the ones listed", () => {
    const checks = Object.entries(files)
      .filter(([file, source]) => !(file in ROLE_CHECKS) && roleChecks(file, source))
      .map(([file]) => file);
    expect(checks, `Check an Owner with requireOwner from @/app/requireOwner instead: ${checks.join(", ")}`).toEqual([]);
    for (const file of Object.keys(ROLE_CHECKS)) expect(roleChecks(file, files[file]), file).toBe(true);

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
    const guard = `export async function requireOwner() {}\nexport async function requireOwnerSession() {}\nexport async function ownerCanUse() {}`;
    const scan = (more: Record<string, string>) => unguarded({ "app/requireOwner.ts": guard, ...more });
    const action = (body: string) => `"use server";\nimport { requireOwner } from "@/app/requireOwner";\n${body}`;

    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { await requireOwner(); }`) })).toEqual([]);
    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { await write(); }`) })).toEqual(["app/dashboard/a.ts#save"]);
    expect(scan({ "app/dashboard/a.ts": action(`export const save = async () => { await write(); };`) })).toEqual([
      "app/dashboard/a.ts#save",
    ]);
    // First, before anything else it awaits; its own arguments run before it.
    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { await write(); await requireOwner(); }`) })).toEqual([
      "app/dashboard/a.ts#save",
    ]);
    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { await write(await requireOwner()); }`) })).toEqual([]);
    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { return requireOwner(); }`) })).toEqual([]);
    expect(scan({ "app/dashboard/a.ts": action(`export const save = async () => requireOwner();`) })).toEqual([]);
    expect(scan({ "app/dashboard/a.ts": action(`export async function save() { await write(); return requireOwner(); }`) })).toEqual([
      "app/dashboard/a.ts#save",
    ]);
    // Through a helper in the same file, or one imported from another.
    expect(
      scan({ "app/dashboard/a.ts": action(`async function owner() { return await requireOwner(); }\nexport async function save() { await owner(); }`) })
    ).toEqual([]);
    expect(
      scan({ "app/dashboard/a.ts": action(`async function owner() { await write(); return await requireOwner(); }\nexport async function save() { await owner(); }`) })
    ).toEqual(["app/dashboard/a.ts#save"]);
    expect(
      scan({
        "app/onboarding/checks.ts": `import { cache } from "react";\nimport { requireOwner } from "../requireOwner";\nexport const load = cache(async () => { await requireOwner(); });`,
        "app/onboarding/page.tsx": `import { load } from "./checks";\nexport default async function Page() { await load(); }`,
      })
    ).toEqual([]);
    // A helper of the same name elsewhere does not count.
    expect(
      scan({
        "app/dashboard/b.ts": action(`export async function owner() { return await requireOwner(); }`),
        "app/dashboard/a.ts": `"use server";\nasync function owner() { return 1; }\nexport async function save() { await owner(); }`,
      })
    ).toEqual(["app/dashboard/a.ts#save"]);
    // Export lists and re-exports, followed to what they name.
    expect(scan({ "app/dashboard/a.ts": `"use server";\nasync function save() { await write(); }\nexport { save, save as other };` })).toEqual([
      "app/dashboard/a.ts#save",
      "app/dashboard/a.ts#other",
    ]);
    const impl = { "app/dashboard/impl.ts": `export async function save() { await write(); }` };
    expect(scan({ ...impl, "app/dashboard/a.ts": `"use server";\nexport { save } from "./impl";` })).toEqual(["app/dashboard/a.ts#save"]);
    expect(scan({ ...impl, "app/dashboard/a.ts": `"use server";\nexport * from "./impl";` })).toEqual(["app/dashboard/a.ts#save"]);
    expect(
      scan({ "app/dashboard/impl.ts": action(`export async function save() { await requireOwner(); }`), "app/dashboard/a.ts": `"use server";\nexport * from "./impl";` })
    ).toEqual([]);
    // Pages, route handlers, metadata routes and inline actions.
    expect(scan({ "app/dashboard/x/page.tsx": `import { db } from "@/lib/db";\nexport default async function Page() {}` })).toEqual([
      "app/dashboard/x/page.tsx#default",
    ]);
    expect(scan({ "app/dashboard/x/route.ts": `import { db } from "@/lib/db";\nexport async function GET() {}` })).toEqual([
      "app/dashboard/x/route.ts#GET",
    ]);
    expect(
      scan({ "app/dashboard/x/opengraph-image.tsx": `import { db } from "@/lib/db";\nexport const size = { width: 1 };\nexport default async function Image() { await db.x(); }` })
    ).toEqual(["app/dashboard/x/opengraph-image.tsx#default"]);
    expect(scan({ "app/dashboard/sitemap.ts": `import { db } from "@/lib/db";\nexport default async function sitemap() {}` })).toEqual([
      "app/dashboard/sitemap.ts#default",
    ]);
    expect(
      scan({
        "app/dashboard/x/page.tsx": `import { requireOwner } from "@/app/requireOwner";\nexport default async function Page() {\n  await requireOwner();\n  async function go() { "use server"; await write(); }\n}`,
      })
    ).toEqual(["app/dashboard/x/page.tsx#go"]);
    // A page that can only redirect.
    expect(
      scan({ "app/dashboard/x/page.tsx": `import { redirect } from "next/navigation";\nexport default function Page() { redirect("/"); }` })
    ).toEqual([]);
    // A session-only layout reads nothing before owners.canUse.
    const layout = (body: string) =>
      `import { ext } from "@/extensions";\nimport { ownerCanUse, requireOwnerSession } from "@/app/requireOwner";\nexport default async function Layout() {\n  const { ownerId } = await requireOwnerSession();\n${body}\n}`;
    expect(scan({ "app/dashboard/layout.tsx": layout(`await ext.dashboard.gate(ownerId);\nif (await ownerCanUse(ownerId)) await list(ownerId);`) })).toEqual([]);
    expect(scan({ "app/dashboard/layout.tsx": layout(`await list(ownerId);\nawait ownerCanUse(ownerId);`) })).toEqual([
      "app/dashboard/layout.tsx#default (reads before owners.canUse)",
    ]);
    expect(scan({ "app/dashboard/layout.tsx": layout(`await list(ownerId);`) })).toEqual([
      "app/dashboard/layout.tsx#default (reads before owners.canUse)",
    ]);
    // Outside the Owner areas.
    expect(scan({ "app/affiliates/a.ts": `"use server";\nexport async function save() {}` })).toEqual([]);
  });

  it("finds a role check however it is written", () => {
    const check = (code: string) => roleChecks("x.ts", code);
    expect(check(`if (session.user.role !== "owner") {}`)).toBe(true);
    expect(check(`if ("owner" == token.role) {}`)).toBe(true);
    expect(check(`if (session?.user?.role === 'owner') {}`)).toBe(true);
    expect(check(`if (["owner", "admin"].includes(user.role)) {}`)).toBe(true);
    expect(check(`switch (user.role) { case "owner": break; }`)).toBe(true);
    expect(check(`const user = { role: "owner" };`)).toBe(false);
    expect(check(`if (role === rule.role) {}`)).toBe(false);
  });
});
