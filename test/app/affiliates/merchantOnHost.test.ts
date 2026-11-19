// Every affiliate page, layout and server action finds its product through
// merchantOnHost (directly or through requireAffiliate), so owners.serves is
// asked on every way in. Read from the source, so a new page or action that
// looks the product up on its own fails here.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.join(__dirname, "..", "..", "..", "src");
const ROOT = path.join(SRC, "app", "affiliates");

// Changes nothing about the product: only the visitor's own session.
const EXEMPT = ["dashboard/signOutAffiliate.ts"];
// The guard itself, and the page it sends a turned-away visitor to.
const GUARDS = ["merchantOnHost.ts", "requireAffiliate.ts", "paused/page.tsx"];
const CONVENTION = /(^|\/)(page|layout|route)\.tsx?$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function parse(file: string): ts.SourceFile {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  return ts.createSourceFile(file, readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true, kind);
}

/** The directive prologue, comments and blank lines ignored. */
function isServerModule(sf: ts.SourceFile): boolean {
  for (const statement of sf.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isStringLiteral(statement.expression)) return false;
    if (statement.expression.text === "use server") return true;
  }
  return false;
}

function hasModifier(node: ts.Node, kind: ts.SyntaxKind): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === kind);
}

/** Exported functions by name: every one in a server module, the default export elsewhere. */
function entryFunctions(sf: ts.SourceFile, server: boolean): Map<string, ts.Node> {
  const found = new Map<string, ts.Node>();
  for (const statement of sf.statements) {
    if (!hasModifier(statement, ts.SyntaxKind.ExportKeyword)) continue;
    const isDefault = hasModifier(statement, ts.SyntaxKind.DefaultKeyword);
    if (ts.isFunctionDeclaration(statement) && (server || isDefault)) {
      found.set(isDefault ? "default" : (statement.name?.text ?? "?"), statement);
    }
    if (server && ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        if (decl.initializer && ts.isIdentifier(decl.name)) found.set(decl.name.text, decl.initializer);
      }
    }
  }
  return found;
}

/** Names of the functions a node calls, comments never counted. */
function calls(node: ts.Node): Set<string> {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

const entries = files(ROOT).flatMap((full) => {
  const file = path.relative(ROOT, full).split(path.sep).join("/");
  if (EXEMPT.includes(file) || GUARDS.includes(file)) return [];
  const sf = parse(full);
  const server = isServerModule(sf);
  if (!server && !CONVENTION.test(file)) return [];
  return [...entryFunctions(sf, server)].map(([name, fn]) => ({ id: `${file}#${name}`, fn, sf }));
});

describe("affiliate entry points", () => {
  it("finds every page and action", () => {
    expect(entries.length).toBeGreaterThanOrEqual(19);
  });

  it.each(entries.map(({ id }) => id))("%s finds its product through merchantOnHost", (id) => {
    const { fn, sf } = entries.find((entry) => entry.id === id)!;
    const called = calls(fn);
    expect(called.has("merchantOnHost") || called.has("requireAffiliate")).toBe(true);
    expect(calls(sf).has("getMerchantByDomain")).toBe(false);
  });

  it("reads a server module's directive after leading comments", () => {
    const sf = ts.createSourceFile("x.ts", '// note\n\n/* more */\n"use server";\nexport async function a() {}', ts.ScriptTarget.Latest, true);
    expect(isServerModule(sf)).toBe(true);
    expect([...entryFunctions(sf, true).keys()]).toEqual(["a"]);
  });

  it("does not count a call written in a comment", () => {
    const sf = ts.createSourceFile("x.ts", "export async function a() { // await merchantOnHost(host)\n }", ts.ScriptTarget.Latest, true);
    expect(calls(sf).has("merchantOnHost")).toBe(false);
  });

  it("refuses an affiliate sign-in posted to Auth.js for a product that is not served", () => {
    const sf = parse(path.join(SRC, "app", "api", "auth", "[...nextauth]", "route.ts"));
    const post = entryFunctions(sf, true).get("POST");
    expect(post).toBeDefined();
    expect(calls(post!).has("productOnHost")).toBe(true);
    expect(post!.getText()).toContain("affiliate-password");
  });
});
