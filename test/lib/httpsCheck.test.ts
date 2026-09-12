import { describe, it, expect } from "vitest";
import { httpsReachable } from "@/lib/checks/dns";
import { certificatePending, dnsCheckRows } from "@/components/onboarding/checkRows";

// The failure this exists for: inside the app container, fetching the
// product's own public address routes out to the host's own IP and back,
// which a great many hosts do not hairpin. The site is fine from the
// internet and the container alone cannot reach it.
const resolves = async () => ["146.59.195.140"];
const neverFetch: typeof fetch = async () => {
  throw new Error("the round trip must not be attempted when our own proxy answered");
};

describe("httpsReachable", () => {
  it("passes on our proxy's own certificate, without any round trip", async () => {
    const result = await httpsReachable("go.example.com", neverFetch, resolves, async () => ({
      kind: "valid",
      issuer: "Let's Encrypt",
    }));
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(true);
    expect(result.certificate.detail).toBe("Issued by Let's Encrypt");
  });

  it("reads a certificate that is not trusted yet as still being set up, not as unreachable", async () => {
    const result = await httpsReachable("go.example.com", neverFetch, resolves, async () => ({
      kind: "untrusted",
      reason: "self signed",
    }));
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(false);
    expect(result.certificate.detail).toBe("Being set up");
  });

  it("falls back to the round trip only when there is no proxy of ours to ask", async () => {
    let asked = "";
    const fetchFn = (async (url: string) => {
      asked = String(url);
      return { status: 200 } as Response;
    }) as unknown as typeof fetch;

    const result = await httpsReachable("go.example.com", fetchFn, resolves, async () => ({
      kind: "no-proxy",
      reason: "ENOTFOUND",
    }));
    expect(asked).toBe("https://go.example.com/track.js");
    expect(result.reachable.ok).toBe(true);
    expect(result.certificate.ok).toBe(true);
  });

  it("says nothing is in DNS yet before it probes anything", async () => {
    const result = await httpsReachable(
      "go.example.com",
      neverFetch,
      async () => {
        throw new Error("ENOTFOUND");
      },
      async () => {
        throw new Error("the probe must not run without a record");
      }
    );
    expect(result.reachable.detail).toBe("No record found yet");
  });
});

describe("the certificate row", () => {
  const no = (detail: string) => ({ ok: false, detail });
  const ok = { ok: true, detail: "" };

  it("waits rather than failing, because the certificate is nobody's task", () => {
    expect(certificatePending("Being set up")).toBe(true);
    expect(certificatePending("Nothing answered")).toBe(true);

    const rows = dnsCheckRows({ resolves: ok, https: ok, certificate: no("Being set up") });
    expect(rows.find((r) => r.id === "cert")?.state).toBe("pending");
  });

  it("carries the one line explaining that it happens on its own", () => {
    const rows = dnsCheckRows({ resolves: ok, https: ok, certificate: no("Being set up") });
    expect(rows.find((r) => r.id === "cert")?.info).toContain("nothing for you to do");
  });

  it("passes once the certificate is there", () => {
    const rows = dnsCheckRows({ resolves: ok, https: ok, certificate: ok });
    expect(rows.find((r) => r.id === "cert")?.state).toBe("ok");
  });
});
