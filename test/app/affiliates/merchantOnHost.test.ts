// Every affiliate page, layout and server action finds its product through
// merchantOnHost (directly or through requireAffiliate), so owners.serves is
// asked on every way in. Read from the source, so a new page or action that
// looks the product up on its own fails here.
import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const ROOT = path.join(__dirname, "..", "..", "..", "src", "app", "affiliates");

// Changes nothing about the product: only the visitor's own session.
const EXEMPT = ["dashboard/signOutAffiliate.ts"];
// The guard itself, and the page it sends a turned-away visitor to.
const GUARDS = ["merchantOnHost.ts", "requireAffiliate.ts", "paused/page.tsx"];

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? files(full) : /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

const entryPoints = files(ROOT)
  .map((file) => ({ file: path.relative(ROOT, file).split(path.sep).join("/"), source: readFileSync(file, "utf8") }))
  .filter(({ file, source }) => /(^|\/)(page|layout|route)\.tsx?$/.test(file) || /^\s*["']use server["']/.test(source))
  .filter(({ file }) => !EXEMPT.includes(file) && !GUARDS.includes(file));

describe("affiliate entry points", () => {
  it("finds some", () => {
    expect(entryPoints.length).toBeGreaterThan(10);
  });

  it.each(entryPoints.map(({ file }) => file))("%s finds its product through merchantOnHost", (file) => {
    const { source } = entryPoints.find((entry) => entry.file === file)!;
    expect(source).toMatch(/\bawait (merchantOnHost|requireAffiliate)\(/);
    expect(source).not.toMatch(/\bgetMerchantByDomain\b/);
  });
});
