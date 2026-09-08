import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  compareVersions,
  parseRelease,
  installedVersion,
  updateCheckEnabled,
  availableUpdate,
  refreshLatestRelease,
  resetReleaseCache,
  DEV_VERSION,
} from "@/lib/version";

const T0 = 1_700_000_000_000;

function release(overrides: Record<string, unknown> = {}) {
  return {
    tag_name: "v0.2.0",
    html_url: "https://github.com/ugolbck/supaffi/releases/tag/v0.2.0",
    body: "Fixed a thing.",
    ...overrides,
  };
}

function respondWith(payload: unknown, ok = true) {
  const fetchMock = vi.fn(async () => ({ ok, json: async () => payload }) as unknown as Response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  resetReleaseCache();
  delete process.env.SUPAFFI_VERSION;
  delete process.env.SUPAFFI_UPDATE_CHECK;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("installedVersion", () => {
  it("reports dev when nothing was baked in", () => {
    expect(installedVersion()).toBe(DEV_VERSION);
  });

  it("reports what the image carries", () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    expect(installedVersion()).toBe("0.1.0");
  });

  it("falls back to dev on a value that is not a version", () => {
    // Otherwise it compares as 0 against every release and the instance shows
    // an update notice it can never clear.
    process.env.SUPAFFI_VERSION = "not-a-version";
    expect(installedVersion()).toBe(DEV_VERSION);
  });
});

describe("compareVersions", () => {
  it("orders by each part in turn", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0", "0.99.99")).toBeGreaterThan(0);
    expect(compareVersions("0.1.0", "0.1.0")).toBe(0);
    expect(compareVersions("0.1.0", "0.1.1")).toBeLessThan(0);
  });

  it("does not compare part counts as strings", () => {
    // "0.10.0" sorts before "0.9.0" as text, which would tell an operator on
    // the newer version that they are behind.
    expect(compareVersions("0.10.0", "0.9.0")).toBeGreaterThan(0);
  });

  it("treats a missing part as zero", () => {
    expect(compareVersions("1.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.1", "1.0")).toBeGreaterThan(0);
  });
});

describe("parseRelease", () => {
  it("strips the leading v from the tag", () => {
    expect(parseRelease(release())?.version).toBe("0.2.0");
  });

  it("refuses a tag that is not a version", () => {
    expect(parseRelease(release({ tag_name: "nightly" }))).toBeNull();
  });

  it("refuses a payload with no tag", () => {
    expect(parseRelease({})).toBeNull();
    expect(parseRelease(null)).toBeNull();
  });

  it("marks a release whose notes have a security section", () => {
    expect(parseRelease(release({ body: "### Security\nFixed a hole." }))?.security).toBe(true);
    expect(parseRelease(release({ body: "## Security\nFixed a hole." }))?.security).toBe(true);
  });

  it("keeps a link only when it points at this repository", () => {
    const fallback = "https://github.com/ugolbck/supaffi/releases";
    expect(parseRelease(release({ html_url: "https://evil.example.com/x" }))?.url).toBe(fallback);
    expect(parseRelease(release({ html_url: "javascript:alert(1)" }))?.url).toBe(fallback);
    expect(parseRelease(release({ html_url: 42 }))?.url).toBe(fallback);
  });

  it("does not mark an ordinary release", () => {
    expect(parseRelease(release())?.security).toBe(false);
    // The word alone is not the heading. Otherwise every release that mentions
    // security in passing shows the loud notice and the loud notice stops
    // meaning anything.
    expect(parseRelease(release({ body: "Improved security headers." }))?.security).toBe(false);
  });
});

describe("availableUpdate", () => {
  it("says nothing on a build with no version", async () => {
    const fetchMock = respondWith(release());
    expect(availableUpdate(T0)).toBeNull();
    // And does not ask, because there is no honest comparison to make.
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("says nothing when the check is off", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    process.env.SUPAFFI_UPDATE_CHECK = "off";
    const fetchMock = respondWith(release());
    expect(availableUpdate(T0)).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never waits on the network, and answers on the next call", async () => {
    // The whole point: a dashboard render must not sit behind a request that
    // can take five seconds to time out on a server with no outbound access.
    process.env.SUPAFFI_VERSION = "0.1.0";
    respondWith(release());

    expect(availableUpdate(T0)).toBeNull();
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0)?.version).toBe("0.2.0");
  });

  it("says nothing when this is the newest", async () => {
    process.env.SUPAFFI_VERSION = "0.2.0";
    respondWith(release());
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0)).toBeNull();
  });

  it("says nothing when the version installed is ahead of the release", async () => {
    process.env.SUPAFFI_VERSION = "0.3.0";
    respondWith(release());
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0)).toBeNull();
  });

  it("survives GitHub being unreachable", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("network down");
      })
    );
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0)).toBeNull();
  });

  it("survives an error response", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    respondWith({ message: "Not Found" }, false);
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0)).toBeNull();
  });
});

describe("caching", () => {
  it("asks once, not on every render", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    const fetchMock = respondWith(release());
    await refreshLatestRelease(T0);
    availableUpdate(T0 + 1000);
    availableUpdate(T0 + 60_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("shares one request between renders that overlap", async () => {
    // Without this, every render arriving during a check opens its own socket
    // and each waits out the same timeout.
    process.env.SUPAFFI_VERSION = "0.1.0";
    const fetchMock = respondWith(release());
    await Promise.all([refreshLatestRelease(T0), refreshLatestRelease(T0), refreshLatestRelease(T0)]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("asks again once the answer is stale", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    const fetchMock = respondWith(release());
    await refreshLatestRelease(T0);
    availableUpdate(T0 + 6 * 60 * 60 * 1000);
    await refreshLatestRelease(T0 + 6 * 60 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("keeps showing the last answer while a stale one is being refreshed", async () => {
    // Otherwise the notice disappears and reappears on every expiry.
    process.env.SUPAFFI_VERSION = "0.1.0";
    respondWith(release());
    await refreshLatestRelease(T0);
    expect(availableUpdate(T0 + 6 * 60 * 60 * 1000)?.version).toBe("0.2.0");
  });

  it("retries a failure sooner than it re-reads a success", async () => {
    process.env.SUPAFFI_VERSION = "0.1.0";
    const fetchMock = vi.fn(async () => {
      throw new Error("network down");
    });
    vi.stubGlobal("fetch", fetchMock);
    await refreshLatestRelease(T0);
    availableUpdate(T0 + 29 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    availableUpdate(T0 + 30 * 60 * 1000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

describe("updateCheckEnabled", () => {
  it("is on by default", () => {
    expect(updateCheckEnabled()).toBe(true);
  });

  it("is off only for the exact word", () => {
    process.env.SUPAFFI_UPDATE_CHECK = "OFF";
    expect(updateCheckEnabled()).toBe(false);
    process.env.SUPAFFI_UPDATE_CHECK = "false";
    expect(updateCheckEnabled()).toBe(true);
  });
});
