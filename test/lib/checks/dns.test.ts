import { describe, it, expect, vi } from "vitest";
import {
  resolvesTo,
  httpsReachable,
  detectDnsProvider,
  resolveAuthoritative,
  registrableCandidates,
} from "@/lib/checks/dns";
import { cloudflareDnsRecordsUrl } from "@/lib/dnsProviderLinks";

describe("registrableCandidates", () => {
  it("offers the two label form first, then the three label form", () => {
    expect(registrableCandidates("affiliates.dev.mokkit.co")).toEqual([
      "mokkit.co",
      "dev.mokkit.co",
    ]);
  });
});

describe("resolveAuthoritative", () => {
  const deps = (over = {}) => ({
    resolveNs: async () => ["ns1.cloudflare.com"],
    resolve4: async (h: string) => (h === "ns1.cloudflare.com" ? ["9.9.9.9"] : ["1.1.1.1"]),
    makeResolver: () => ({ resolve4: async () => ["203.0.113.10"] }),
    ...over,
  });

  it("asks the zone's own nameservers, not the system resolver", async () => {
    // The whole point: the system resolver may be holding a cached NXDOMAIN
    // from before the owner created the record.
    const answer = await resolveAuthoritative("affiliates.dev.mokkit.co", deps());
    expect(answer).toEqual(["203.0.113.10"]);
  });

  it("falls back to the system resolver when the nameservers cannot be found", async () => {
    const answer = await resolveAuthoritative(
      "affiliates.dev.mokkit.co",
      deps({ resolveNs: async () => { throw new Error("no NS"); } })
    );
    expect(answer).toEqual(["1.1.1.1"]);
  });

  it("falls back when a nameserver name has no address", async () => {
    const answer = await resolveAuthoritative(
      "affiliates.dev.mokkit.co",
      deps({ resolve4: async (h: string) => (h === "ns1.cloudflare.com" ? [] : ["1.1.1.1"]) })
    );
    expect(answer).toEqual(["1.1.1.1"]);
  });
});

describe("resolvesTo", () => {
  it("passes when the hostname points at this server", async () => {
    const result = await resolvesTo("affiliates.instantgradient.com", "146.59.195.140", async () => ["146.59.195.140"]);
    expect(result.ok).toBe(true);
  });

  it("fails and names the address it found instead", async () => {
    const result = await resolvesTo("affiliates.instantgradient.com", "146.59.195.140", async () => ["104.21.0.1"]);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("104.21.0.1");
  });

  it("passes when SUPAFFI_HOST_IP is a hostname that resolves to the same address", async () => {
    const resolve = async (h: string) =>
      h === "affiliates.instantgradient.com" ? ["146.59.195.140"] : ["146.59.195.140"];
    const result = await resolvesTo("affiliates.instantgradient.com", "vps.example.com", resolve, resolve);
    expect(result.ok).toBe(true);
  });

  it("fails when a hostname SUPAFFI_HOST_IP resolves somewhere else", async () => {
    const resolve = async (h: string) =>
      h === "affiliates.instantgradient.com" ? ["104.21.0.1"] : ["146.59.195.140"];
    const result = await resolvesTo("affiliates.instantgradient.com", "vps.example.com", resolve, resolve);
    expect(result.ok).toBe(false);
    expect(result.detail).toContain("104.21.0.1");
  });

  it("fails when a hostname SUPAFFI_HOST_IP cannot be resolved", async () => {
    const resolve = async (h: string) => {
      if (h === "affiliates.instantgradient.com") return ["104.21.0.1"];
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    };
    const result = await resolvesTo("affiliates.instantgradient.com", "vps.example.com", resolve, resolve);
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/server's address .* could not be resolved/i);
  });

  it("resolves the polled hostname with the injected resolver and expected with the plain one", async () => {
    const seen: Record<string, string> = {};
    const resolve = async (h: string) => {
      seen.hostname = h;
      return ["146.59.195.140"];
    };
    const resolveExpected = async (h: string) => {
      seen.expected = h;
      return ["146.59.195.140"];
    };
    const result = await resolvesTo(
      "affiliates.instantgradient.com",
      "vps.example.com",
      resolve,
      resolveExpected
    );
    expect(result.ok).toBe(true);
    expect(seen.hostname).toBe("affiliates.instantgradient.com");
    expect(seen.expected).toBe("vps.example.com");
  });

  it("fails when there is no record yet", async () => {
    const result = await resolvesTo("affiliates.instantgradient.com", "146.59.195.140", async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no record/i);
  });

  it("passes when the authoritative answer carries this server's address", async () => {
    const result = await resolvesTo("affiliates.dev.mokkit.co", "203.0.113.10", async () => [
      "203.0.113.10",
    ]);
    expect(result.ok).toBe(true);
  });
});

describe("httpsReachable", () => {
  const resolves = async () => ["146.59.195.140"];

  it("passes both when the server answers", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const result = await httpsReachable(
      "affiliates.instantgradient.com",
      fetchMock as unknown as typeof fetch,
      resolves
    );
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://affiliates.instantgradient.com/track.js", expect.anything());
  });

  it("tells a certificate problem apart from an unreachable server", async () => {
    const certError = Object.assign(new Error("cert"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } });
    const result = await httpsReachable(
      "x.test",
      (async () => { throw certError; }) as unknown as typeof fetch,
      resolves
    );
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(false);
  });

  it("fails reachable when nothing answers", async () => {
    const down = Object.assign(new Error("down"), { cause: { code: "ECONNREFUSED" } });
    const result = await httpsReachable(
      "x.test",
      (async () => { throw down; }) as unknown as typeof fetch,
      resolves
    );
    expect(result.reachable.ok).toBe(false);
    expect(result.certificate.ok).toBe(false);
  });

  it("fails fast with 'No record found yet' when the name has no DNS record", async () => {
    const fetchMock = vi.fn();
    const result = await httpsReachable(
      "affiliates.dev.mokkit.co",
      fetchMock as unknown as typeof fetch,
      async () => { throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" }); }
    );
    expect(result.reachable.ok).toBe(false);
    expect(result.reachable.detail).toMatch(/no record/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("detectDnsProvider", () => {
  it("recognises Cloudflare from the nameservers of the parent domain", async () => {
    const resolveNs = vi.fn(async (h: string) =>
      h === "instantgradient.com" ? ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"] : []
    );
    expect(await detectDnsProvider("affiliates.instantgradient.com", resolveNs)).toBe("cloudflare");
  });

  it("answers unknown for anything else", async () => {
    expect(await detectDnsProvider("affiliates.mokkit.co", async () => ["ns1.ovh.net"])).toBe("unknown");
  });

  it("gives up on a resolver that never answers instead of holding the page open", async () => {
    vi.useFakeTimers();
    try {
      const answer = detectDnsProvider("affiliates.mokkit.co", () => new Promise<string[]>(() => {}));
      // Both candidates time out, three seconds each.
      await vi.advanceTimersByTimeAsync(7000);
      expect(await answer).toBe("unknown");
    } finally {
      vi.useRealTimers();
    }
  });

  it("answers unknown when lookup fails", async () => {
    expect(await detectDnsProvider("affiliates.mokkit.co", async () => { throw new Error("x"); })).toBe("unknown");
  });
});

describe("cloudflareDnsRecordsUrl", () => {
  it("is the deep link Cloudflare documents", () => {
    expect(cloudflareDnsRecordsUrl()).toBe("https://dash.cloudflare.com/?to=/:account/:zone/dns/records");
  });
});
