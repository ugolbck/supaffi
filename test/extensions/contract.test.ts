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
      domains: { requireOwnershipProof: false, reserved: [] },
      outbound: { blockPrivateAddresses: false },
      mail: { platformServer: null },
    });
  });

  it("add nothing to the dashboard or the account page", async () => {
    const { ext } = await import("@/extensions");
    expect(await ext.dashboard.gate("owner-1")).toEqual({});
    expect(await ext.dashboard.banner("owner-1")).toBeNull();
    expect(await ext.account.sections("owner-1")).toEqual([]);
  });

  it("let every Owner use the dashboard", async () => {
    const { ext } = await import("@/extensions");
    expect(await ext.owners.canUse("owner-1")).toBe(true);
  });

  it("serve every Owner's products", async () => {
    const { ext } = await import("@/extensions");
    expect(await ext.owners.serves("owner-1")).toBe(true);
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
      domains: { requireOwnershipProof: false, reserved: [] },
      outbound: { blockPrivateAddresses: false },
      mail: { platformServer: null },
    });
  });

  it("reads an empty signup path as none", async () => {
    vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { owners: { signupPath: "" } } }));
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt.owners.signupPath).toBeNull();
  });

  it("reads an empty password reset path as none", async () => {
    vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { owners: { passwordResetPath: "  " } } }));
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt.owners.passwordResetPath).toBeNull();
  });

  it("reads reserved domains as hostnames: lowercase, punycode, trimmed, no trailing dot or empty entries", async () => {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { domains: { reserved: [" Example.COM. ", "Bücher.de", "", "  "] } },
    }));
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt.domains).toEqual({ requireOwnershipProof: false, reserved: ["example.com", "xn--bcher-kva.de"] });
  });

  it("reads the platform mail server trimmed, its address in lowercase, and one with no host as none", async () => {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { mail: { platformServer: { host: " Mail.Example.com ", port: 465, user: " u ", password: "p", from: " NoReply@Example.com ", dailyLimitPerOwner: 500 } } },
    }));
    const { staticExt } = await import("@/extensions/static");
    expect(staticExt.mail.platformServer).toEqual({ host: "mail.example.com", port: 465, user: "u", password: "p", from: "noreply@example.com", dailyLimitPerOwner: 500 });

    vi.resetModules();
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { mail: { platformServer: { host: undefined, port: 587, user: "", password: "", from: "" } } },
    }));
    expect((await import("@/extensions/static")).staticExt.mail.platformServer).toBeNull();
  });

  it.each([
    [{ from: "Shop <a@example.com>" }, "is not one bare address"],
    [{ from: "a@example.com, b@example.com" }, "is not one bare address"],
    [{ port: 0 }, "is out of range"],
    [{ dailyLimitPerOwner: 0 }, "is not a whole number above zero"],
    [{ dailyLimitPerOwner: 1.5 }, "is not a whole number above zero"],
  ])("refuses a platform mail server with %o at startup", async (change, message) => {
    const server = { host: "mail.example.com", port: 587, user: "", password: "", from: "a@example.com", ...change };
    vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { mail: { platformServer: server } } }));
    await expect(import("@/extensions/static")).rejects.toThrow(message);
  });

  it.each(["*.example.com", ".example.com", "example.com:443", "https://example.com", "example.com/path", "exa mple.com"])(
    "refuses %s as a reserved domain at startup",
    async (entry) => {
      vi.doMock("@/extensions/installed-static", () => ({ installedStatic: { domains: { reserved: [entry] } } }));
      await expect(import("@/extensions/static")).rejects.toThrow("is not a bare hostname");
    }
  );
});

it("keeps the API version on one line a build can read", () => {
  const source = readFileSync(path.join(__dirname, "../../src/extensions/types.ts"), "utf8");
  expect(source).toMatch(/^export const EXTENSIONS_API_VERSION = \d+;$/m);
});
