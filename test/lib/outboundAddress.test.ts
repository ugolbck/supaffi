// outbound.blockPrivateAddresses: what counts as internal, and that every
// connection to a host an Owner typed in goes to the address that was
// checked, never to the name again.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { isInternalAddress, publicAddresses, PrivateAddressError } from "@/lib/outboundAddress";

describe("isInternalAddress", () => {
  it.each([
    "0.0.0.0",
    "0.255.255.255",
    "10.0.0.0",
    "10.255.255.255",
    "100.64.0.0",
    "100.127.255.255",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.0.0",
    "169.254.169.254",
    "172.16.0.0",
    "172.31.255.255",
    "192.0.0.0",
    "192.0.0.255",
    "192.168.0.1",
    "198.18.0.0",
    "198.19.255.255",
    "224.0.0.1",
    "239.255.255.255",
    "240.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "[::1]",
    "fc00::1",
    "fdff:ffff::1",
    "fe80::1",
    "fe80::1%eth0",
    "febf:ffff::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:7f00:1",
    "::ffff:10.0.0.1",
    "0:0:0:0:0:ffff:a9fe:a9fe",
    "::127.0.0.1",
    "::a00:1",
    "::ffff:0:127.0.0.1",
    "64:ff9b::10.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b:1::1",
    "2002:7f00:1::1",
    "example.com",
    "",
  ])("refuses %s", (address) => {
    expect(isInternalAddress(address)).toBe(true);
  });

  it.each([
    "1.0.0.0",
    "8.8.8.8",
    "9.255.255.255",
    "11.0.0.0",
    "100.63.255.255",
    "100.128.0.0",
    "126.255.255.255",
    "128.0.0.0",
    "169.253.255.255",
    "169.255.0.0",
    "172.15.255.255",
    "172.32.0.0",
    "192.0.1.0",
    "192.167.255.255",
    "192.169.0.0",
    "198.17.255.255",
    "198.20.0.0",
    "223.255.255.255",
    "2001:4860:4860::8888",
    "64:ff9b::8.8.8.8",
    "2a00:1450::1",
    "fbff:ffff::1",
    "fec0::1",
    "::ffff:8.8.8.8",
    "::ffff:808:808",
  ])("allows %s", (address) => {
    expect(isInternalAddress(address)).toBe(false);
  });
});

describe("publicAddresses", () => {
  it("takes an IP literal as itself, without a lookup", async () => {
    const resolve = vi.fn();
    expect(await publicAddresses("93.184.216.34", resolve)).toEqual(["93.184.216.34"]);
    await expect(publicAddresses("127.0.0.1", resolve)).rejects.toBeInstanceOf(PrivateAddressError);
    expect(resolve).not.toHaveBeenCalled();
  });

  it("refuses a name when any of its addresses is internal", async () => {
    await expect(publicAddresses("mail.example.com", async () => ["93.184.216.34", "10.0.0.5"])).rejects.toBeInstanceOf(
      PrivateAddressError
    );
    await expect(publicAddresses("mail.example.com", async () => ["2606:2800::1", "::ffff:192.168.1.1"])).rejects.toBeInstanceOf(
      PrivateAddressError
    );
  });

  it("returns every address of a public name", async () => {
    expect(await publicAddresses("mail.example.com", async () => ["93.184.216.34", "2606:2800::1"])).toEqual([
      "93.184.216.34",
      "2606:2800::1",
    ]);
  });

  it("fails a name that does not resolve like nodemailer's own DNS failure", async () => {
    const fails = async () => {
      throw Object.assign(new Error("nope"), { code: "ENOTFOUND" });
    };
    await expect(publicAddresses("nope.example.com", fails)).rejects.toMatchObject({ code: "EDNS" });
    await expect(publicAddresses("empty.example.com", async () => [])).rejects.toMatchObject({ code: "EDNS" });
  });

  it("is coded like a server that cannot be reached", () => {
    expect(new PrivateAddressError("h").code).toBe("ECONNECTION");
  });
});

describe("sending mail", () => {
  const createTransport = vi.fn();
  const lookup = vi.fn();
  const SETTINGS = { host: "smtp.example.com", port: 587, user: "u", password: "p", from: "hi@example.com" };
  const EMAIL = { to: "o@example.com", fromName: "Acme", subject: "Hi", text: "t", html: "<p>t</p>" };

  beforeEach(() => {
    vi.resetModules();
    createTransport.mockReset();
    createTransport.mockReturnValue({ sendMail: async () => ({}) });
    lookup.mockReset();
    vi.doMock("nodemailer", () => ({ default: { createTransport } }));
    vi.doMock("node:dns/promises", async (original) => ({ ...(await original<object>()), lookup }));
    vi.doUnmock("@/extensions/installed-static");
  });

  afterEach(() => {
    vi.doUnmock("nodemailer");
    vi.doUnmock("node:dns/promises");
  });

  function block() {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { outbound: { blockPrivateAddresses: true } },
    }));
  }

  it("connects to the name, with no lookup of its own, by default", async () => {
    const { sendWith } = await import("@/lib/mail");
    await sendWith(SETTINGS, EMAIL);
    expect(lookup).not.toHaveBeenCalled();
    const options = createTransport.mock.calls[0][0];
    expect(options.host).toBe("smtp.example.com");
    expect(options).not.toHaveProperty("tls");
    expect(options.requireTLS).toBe(true);
  });

  it("connects to the checked address and checks the certificate against the name when blocking", async () => {
    block();
    lookup.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
    const { sendWith } = await import("@/lib/mail");
    await sendWith(SETTINGS, EMAIL);
    expect(lookup).toHaveBeenCalledWith("smtp.example.com", expect.objectContaining({ all: true }));
    const options = createTransport.mock.calls[0][0];
    expect(options.host).toBe("93.184.216.34");
    expect(options.tls).toEqual({ servername: "smtp.example.com" });
    expect(options.requireTLS).toBe(true);
    expect(options.secure).toBe(false);
  });

  it("refuses a server on a private network, and says so in the test send", async () => {
    block();
    lookup.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);
    const { sendWith, mailErrorText } = await import("@/lib/mail");
    const error = await sendWith(SETTINGS, EMAIL).catch((err: unknown) => err);
    expect(createTransport).not.toHaveBeenCalled();
    expect(mailErrorText(error, SETTINGS)).toBe("That mail server is on a private network. Use its public address.");
  });

  it("refuses an IP literal on a private network without a lookup", async () => {
    block();
    const { sendWith } = await import("@/lib/mail");
    await expect(sendWith({ ...SETTINGS, host: "127.0.0.1" }, EMAIL)).rejects.toThrow("private network");
    expect(lookup).not.toHaveBeenCalled();
    expect(createTransport).not.toHaveBeenCalled();
  });
});

describe("fetching from an Owner's host", () => {
  let server: Server;
  let port: number;

  beforeEach(async () => {
    vi.resetModules();
    vi.doUnmock("@/extensions/installed-static");
    server = createServer((_req, res) => res.end('<script src="https://t.example.com/track.js"></script>'));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    port = (server.address() as AddressInfo).port;
  });

  afterEach(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("uses the plain fetch by default", async () => {
    const { outboundFetch } = await import("@/lib/outboundAddress");
    expect(outboundFetch()).toBe(fetch);
    const { scriptFound } = await import("@/lib/checks/script");
    expect((await scriptFound(`http://127.0.0.1:${port}/`, "t.example.com")).ok).toBe(true);
  });

  it("refuses an internal address, by literal or by name, when blocking", async () => {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { outbound: { blockPrivateAddresses: true } },
    }));
    const fresh = await import("@/lib/outboundAddress");
    const { outboundFetch, publicFetch } = fresh;
    expect(outboundFetch()).toBe(publicFetch);
    for (const url of [`http://127.0.0.1:${port}/`, `http://localhost:${port}/`]) {
      const error = await publicFetch(url).catch((err: unknown) => err);
      expect(error).toBeInstanceOf(TypeError);
      expect((error as TypeError).cause).toBeInstanceOf(fresh.PrivateAddressError);
    }
    const { scriptFound } = await import("@/lib/checks/script");
    expect(await scriptFound(`http://127.0.0.1:${port}/`, "t.example.com")).toEqual({ ok: false, detail: "Could not load the site" });
  });
});

describe("asking a zone's own nameservers", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.doUnmock("@/extensions/installed-static");
  });

  function deps() {
    const makeResolver = vi.fn(() => ({ resolveTxt: async () => [["from the zone"]] }));
    return {
      resolveNs: async () => ["ns1.example.com"],
      resolve4: async () => ["10.0.0.53"],
      resolveTxt: async () => [["from the plain resolver"]],
      makeResolver,
    };
  }

  it("asks a nameserver at any address by default", async () => {
    const { resolveTxtAuthoritative } = await import("@/lib/checks/dns");
    expect(await resolveTxtAuthoritative("_supaffi.example.com", deps())).toEqual(["from the zone"]);
  });

  it("skips a nameserver at an internal address when blocking", async () => {
    vi.doMock("@/extensions/installed-static", () => ({
      installedStatic: { outbound: { blockPrivateAddresses: true } },
    }));
    const { resolveTxtAuthoritative } = await import("@/lib/checks/dns");
    const zone = deps();
    expect(await resolveTxtAuthoritative("_supaffi.example.com", zone)).toEqual(["from the plain resolver"]);
    expect(zone.makeResolver).not.toHaveBeenCalled();
  });
});
