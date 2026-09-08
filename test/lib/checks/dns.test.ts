import { describe, it, expect, vi } from "vitest";
import { resolvesTo, httpsReachable, detectDnsProvider } from "@/lib/checks/dns";
import { cloudflareDnsRecordsUrl } from "@/lib/dnsProviderLinks";

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

  it("fails when there is no record yet", async () => {
    const result = await resolvesTo("affiliates.instantgradient.com", "146.59.195.140", async () => {
      throw Object.assign(new Error("ENOTFOUND"), { code: "ENOTFOUND" });
    });
    expect(result.ok).toBe(false);
    expect(result.detail).toMatch(/no record/i);
  });
});

describe("httpsReachable", () => {
  it("passes both when the server answers", async () => {
    const fetchMock = vi.fn(async () => new Response("", { status: 200 }));
    const result = await httpsReachable("affiliates.instantgradient.com", fetchMock as unknown as typeof fetch);
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith("https://affiliates.instantgradient.com/track.js", expect.anything());
  });

  it("tells a certificate problem apart from an unreachable server", async () => {
    const certError = Object.assign(new Error("cert"), { cause: { code: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" } });
    const result = await httpsReachable("x.test", (async () => { throw certError; }) as unknown as typeof fetch);
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(false);
  });

  it("fails reachable when nothing answers", async () => {
    const down = Object.assign(new Error("down"), { cause: { code: "ECONNREFUSED" } });
    const result = await httpsReachable("x.test", (async () => { throw down; }) as unknown as typeof fetch);
    expect(result.reachable.ok).toBe(false);
    expect(result.certificate.ok).toBe(false);
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

  it("answers unknown when lookup fails", async () => {
    expect(await detectDnsProvider("affiliates.mokkit.co", async () => { throw new Error("x"); })).toBe("unknown");
  });
});

describe("cloudflareDnsRecordsUrl", () => {
  it("is the deep link Cloudflare documents", () => {
    expect(cloudflareDnsRecordsUrl()).toBe("https://dash.cloudflare.com/?to=/:account/:zone/dns/records");
  });
});
