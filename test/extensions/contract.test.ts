// The defaults are this app's own behaviour. If one of these fails, a build
// that installs nothing would no longer get the app as it ships.
import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

beforeEach(() => {
  vi.resetModules();
  vi.doUnmock("@/extensions/installed");
  vi.doUnmock("@/extensions/installed-static");
});

describe("extension defaults", () => {
  it("keep the single-Owner setup and the instance panel", async () => {
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt).toEqual({
      owners: { signupPath: null, passwordResetPath: null },
      instance: { showInfo: true },
    });
  });

  it("add nothing to the dashboard or the account page", async () => {
    const { ext } = await import("@/extensions");
    expect(await ext.dashboard.gate("owner-1")).toEqual({});
    expect(await ext.dashboard.banner("owner-1")).toBeNull();
    expect(await ext.account.sections("owner-1")).toEqual([]);
  });

  it("ship with nothing installed", async () => {
    const { installed } = await import("@/extensions/installed");
    const { installedStatic } = await import("@/extensions/installed-static");
    expect(installed).toEqual({});
    expect(installedStatic).toEqual({});
  });
});

describe("an installed build", () => {
  it("replaces only the hooks it sets", async () => {
    const banner = async () => "installed banner";
    vi.doMock("@/extensions/installed", () => ({ installed: { dashboard: { banner } } }));
    const { ext } = await import("@/extensions");
    expect(await ext.dashboard.banner("owner-1")).toBe("installed banner");
    expect(await ext.dashboard.gate("owner-1")).toEqual({});
  });

  it("falls back to the default for a hook set to undefined", async () => {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { owners: { signupPath: undefined }, instance: { showInfo: false } },
    }));
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt).toEqual({
      owners: { signupPath: null, passwordResetPath: null },
      instance: { showInfo: false },
    });
  });
});

it("keeps the API version on one line a build can read", () => {
  const source = readFileSync(path.join(__dirname, "../../src/extensions/types.ts"), "utf8");
  expect(source).toMatch(/^export const EXTENSIONS_API_VERSION = \d+;$/m);
});
