// Destructive: clears Merchant and Owner before every test. Point
// DATABASE_URL at a disposable database, never a real deployment's data.
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { NextRequest } from "next/server";
import vm from "node:vm";

import { db } from "@/lib/db";
import { GET } from "@/app/track.js/route";
import { REFERRAL_CLIENT_REFERENCE_PREFIX, REFERRAL_COOKIE } from "@/lib/referral";

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

const DOMAIN = "affiliates.acme.test";

async function clear() {
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

async function seedMerchant(domain = DOMAIN) {
  const owner = await db.owner.create({
    data: { email: `track-script-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
  return db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId: owner.id,
      name: "Acme",
      domain,
      websiteUrl: "https://acme.test",
    },
  });
}

function serve(host: string, headers: Record<string, string> = {}) {
  return GET(new NextRequest("http://c0ffee1234ab:3000/track.js", { headers: { host, ...headers } }));
}

async function script(): Promise<string> {
  await seedMerchant();
  return (await serve(DOMAIN)).text();
}

// The repo has no DOM library, so the served script runs against a tiny
// stand-in that implements only what it touches.
class FakeEl {
  nodeType = 1;
  parentNode: FakeEl | null = null;
  children: FakeEl[] = [];
  attrs = new Map<string, string>();
  shadowRoot: object | null = null;
  constructor(public tagName: string, attrs: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(attrs)) this.attrs.set(k, v);
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get href() {
    return new URL(this.attrs.get("href") ?? "", "https://acme.test/").href;
  }
  set href(v: string) {
    this.attrs.set("href", v);
  }
  hasAttribute(k: string) {
    return this.attrs.has(k);
  }
  getAttribute(k: string) {
    return this.attrs.get(k) ?? null;
  }
  setAttribute(k: string, v: string) {
    this.attrs.set(k, v);
  }
  get attached(): boolean {
    return this.parentNode ? this.parentNode.attached : this === root();
  }
  appendChild(child: FakeEl) {
    child.parentNode = this;
    this.children.push(child);
    if (this.attached) notify(child);
    return child;
  }
  // Supports the selector forms the script uses: a tag name, or a tag with a
  // [attr*="value"] filter, comma separated. Anything else throws, so a typo
  // in the script's selector fails a test rather than matching by accident.
  querySelectorAll(selector: string): FakeEl[] {
    const matchers = selector.split(",").map((part) => {
      const m = part.trim().match(/^([a-z-]+)(?:\[([a-z-]+)\*="([^"]*)"\])?$/);
      if (!m) throw new Error(`unsupported selector: ${part}`);
      const [, tag, attr, value] = m;
      return (el: FakeEl) =>
        el.tagName.toLowerCase() === tag && (!attr || (el.attrs.get(attr) ?? "").includes(value));
    });
    const out: FakeEl[] = [];
    const walk = (el: FakeEl) => {
      for (const c of el.children) {
        if (matchers.some((match) => match(c))) out.push(c);
        walk(c);
      }
    };
    walk(this);
    return out;
  }
}

let rootEl: FakeEl;
let observers: Array<(records: Array<{ addedNodes: FakeEl[] }>) => void> = [];
const root = () => rootEl;
function notify(node: FakeEl) {
  for (const cb of observers) cb([{ addedNodes: [node] }]);
}

// Runs the script as a browser would, on a page whose body is built by `build`
// before the script runs. Returns the body and a way to click an element.
async function runOn(
  code: string,
  opts: { search?: string; cookie?: string; blockCookieWrites?: boolean; build?: (body: FakeEl) => void } = {},
) {
  observers = [];
  rootEl = new FakeEl("html");
  const body = rootEl.appendChild(new FakeEl("body"));
  opts.build?.(body);
  const listeners: Array<{ type: string; fn: (e: { target: FakeEl }) => void }> = [];
  // A blocked write (a consent tool wrapping document.cookie) is dropped by the
  // setter; the test's own changes go through `jar` directly.
  let jar = opts.cookie ?? "";
  const document = {
    documentElement: rootEl,
    get cookie() {
      return jar;
    },
    set cookie(v: string) {
      if (!opts.blockCookieWrites) jar = v;
    },
    addEventListener: (type: string, fn: (e: { target: FakeEl }) => void) => listeners.push({ type, fn }),
  };
  const sandbox: Record<string, unknown> = {
    document,
    URL,
    URLSearchParams,
    MutationObserver: class {
      constructor(cb: (records: Array<{ addedNodes: FakeEl[] }>) => void) {
        observers.push(cb);
      }
      observe() {}
    },
    fetch: async () => ({ ok: true, json: async () => ({ referralToken: "fresh_token" }) }),
  };
  sandbox.window = { ...sandbox, location: { search: opts.search ?? "", protocol: "https:" } };
  vm.runInNewContext(code, sandbox);
  await new Promise((r) => setTimeout(r, 0));
  const fire = (type: string, target: FakeEl) =>
    listeners.filter((l) => l.type === type).forEach((l) => l.fn({ target }));
  return {
    body,
    click: (target: FakeEl) => fire("click", target),
    // The visitor comes back to this page after following another affiliate
    // link elsewhere, which replaced the cookie.
    returnWith: (cookie: string) => {
      jar = cookie;
      fire("visibilitychange", rootEl);
    },
    // The cookie changes between page load and a click, with no event between.
    setCookie: (cookie: string) => {
      jar = cookie;
    },
  };
}

const HELD = `${REFERRAL_COOKIE}=held_token`;
const REF = REFERRAL_CLIENT_REFERENCE_PREFIX;
const stripeLink = (href = "https://buy.stripe.com/test_abc") => new FakeEl("a", { href });

describe.skipIf(!hasDatabase)("track.js", () => {
  beforeEach(clear);
  afterAll(clear);

  it("writes the cookie under the namespaced name", async () => {
    // The Merchant's own auth provider shares this cookie jar, so the name has
    // to be one nothing else picks by accident.
    expect(await script()).toContain(`"${REFERRAL_COOKIE}="`);
  });

  it("sends back the token this browser already holds, so a reload keeps its click", async () => {
    const code = await script();
    expect(code).toContain('"&token=" + encodeURIComponent(token)');
  });

  it("never sends SameSite=None, which would make the cookie cross-site", async () => {
    const code = await script();
    expect(code).toContain("SameSite=Lax");
    expect(code).not.toContain("SameSite=None");
  });

  it("adds Secure at runtime rather than baking it in", async () => {
    // A Secure cookie on a plain-HTTP dev site is dropped with no error, and
    // tracking would fail in a way nobody can see. The script decides on the
    // page it actually runs on, not on the scheme this route was served over.
    const code = await script();
    expect(code).toContain('window.location.protocol === "https:" ? "; Secure" : ""');
  });

  it("bakes in the Merchant's stored domain, not the address this process answers on", async () => {
    // Behind the bundled proxy the server sees its own container address.
    // Baking that in points every Merchant's site at a hostname that only
    // resolves inside the Docker network, and nothing is ever tracked.
    const code = await script();
    expect(code).toContain('"https://affiliates.acme.test/api/track?via="');
    expect(code).not.toContain("c0ffee1234ab");
  });

  it("ignores X-Forwarded-Proto, which a request can set to anything", async () => {
    await seedMerchant();
    const code = await (await serve(DOMAIN, { "x-forwarded-proto": 'x";alert(1);//' })).text();
    expect(code).not.toContain("alert");
    expect(code).toContain('"https://affiliates.acme.test/api/track?via="');
  });

  it("uses http for a local development domain", async () => {
    await seedMerchant("localhost:3600");
    const code = await (await serve("localhost:3600")).text();
    expect(code).toContain('"http://localhost:3600/api/track?via="');
  });

  it("serves nothing for a host that is not a Merchant", async () => {
    await seedMerchant();
    const res = await serve('evil.test";alert(1);//');
    expect(res.status).toBe(404);
  });

  it("can be cached, but never across Merchants", async () => {
    await seedMerchant();
    const res = await serve(DOMAIN);
    expect(res.headers.get("cache-control")).toContain("max-age=");
    expect(res.headers.get("vary")).toBe("Host");
  });

  it("tags a Payment Link with the referral", async () => {
    const link = stripeLink();
    await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
  });

  it("keeps a client_reference_id the Merchant already set", async () => {
    const link = stripeLink("https://buy.stripe.com/test_abc?client_reference_id=user_42");
    await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe("user_42");
  });

  it("leaves links to anywhere else alone", async () => {
    const other = new FakeEl("a", { href: "https://example.com/pay" });
    const lookalike = new FakeEl("a", { href: "https://example.com/?u=buy.stripe.com" });
    await runOn(await script(), {
      cookie: HELD,
      build: (b) => {
        b.appendChild(other);
        b.appendChild(lookalike);
      },
    });
    expect(other.getAttribute("href")).toBe("https://example.com/pay");
    expect(lookalike.getAttribute("href")).toBe("https://example.com/?u=buy.stripe.com");
  });

  it("tags the buy button and the pricing table, and keeps one the Merchant set", async () => {
    const button = new FakeEl("stripe-buy-button");
    const table = new FakeEl("stripe-pricing-table");
    const own = new FakeEl("stripe-buy-button", { "client-reference-id": "user_42" });
    await runOn(await script(), {
      cookie: HELD,
      build: (b) => [button, table, own].forEach((el) => b.appendChild(el)),
    });
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
    expect(table.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
    expect(own.getAttribute("client-reference-id")).toBe("user_42");
  });

  it("sets the attribute on an embed that had already rendered, without replacing it", async () => {
    const rendered = new FakeEl("stripe-buy-button");
    rendered.shadowRoot = {};
    const { body } = await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(rendered) });
    expect(body.children[0]).toBe(rendered);
    expect(rendered.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
  });

  it("looks up exactly the anchors and the two Stripe components", async () => {
    // The fake DOM only understands this selector, so a typo in the script's
    // selector fails the other tests; this pins what it is meant to match.
    const code = await script();
    expect(code).toContain(`'a[href*="buy.stripe.com"], stripe-buy-button, stripe-pricing-table'`);
  });

  it("tags elements added after the script ran", async () => {
    const { body } = await runOn(await script(), { cookie: HELD });
    const link = stripeLink();
    const button = new FakeEl("stripe-buy-button");
    const wrapper = new FakeEl("div");
    wrapper.appendChild(button);
    body.appendChild(link);
    body.appendChild(wrapper);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
  });

  it("tags a link whose href changed after load when it is clicked", async () => {
    const link = stripeLink();
    const { click } = await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    link.href = "https://buy.stripe.com/test_other";
    click(link);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
  });

  it("tags on a page without ?via= from the held cookie", async () => {
    const link = stripeLink();
    await runOn(await script(), { cookie: `a=1; ${HELD}`, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
  });

  it("uses the fresh token from ?via= rather than the held one", async () => {
    const link = stripeLink();
    await runOn(await script(), { search: "?via=sarah", cookie: HELD, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}fresh_token`);
  });

  it("tags nothing when no token is known", async () => {
    const link = stripeLink();
    const button = new FakeEl("stripe-buy-button");
    const { body } = await runOn(await script(), {
      build: (b) => [link, button].forEach((el) => b.appendChild(el)),
    });
    const late = stripeLink();
    body.appendChild(late);
    expect(link.getAttribute("href")).toBe("https://buy.stripe.com/test_abc");
    expect(late.getAttribute("href")).toBe("https://buy.stripe.com/test_abc");
    expect(button.hasAttribute("client-reference-id")).toBe(false);
  });

  it("replaces an older affiliate's token in a link, including at click time", async () => {
    const link = stripeLink(`https://buy.stripe.com/test_abc?client_reference_id=${REF}old_token`);
    const { click, setCookie } = await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
    setCookie(`${REFERRAL_COOKIE}=newer_token`);
    click(link);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}newer_token`);
  });

  it("keeps every other query parameter when it swaps the token", async () => {
    const link = stripeLink(`https://buy.stripe.com/test_abc?prefilled_email=a%40b.co&client_reference_id=${REF}old_token`);
    await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    const params = new URL(link.href).searchParams;
    expect(params.get("prefilled_email")).toBe("a@b.co");
    expect(params.get("client_reference_id")).toBe(`${REF}held_token`);
  });

  it("replaces an older affiliate's token on the embeds", async () => {
    const button = new FakeEl("stripe-buy-button", { "client-reference-id": `${REF}old_token` });
    const table = new FakeEl("stripe-pricing-table", { "client-reference-id": `${REF}old_token` });
    await runOn(await script(), { cookie: HELD, build: (b) => [button, table].forEach((el) => b.appendChild(el)) });
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
    expect(table.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
  });

  it("moves a page left open to the newer affiliate when the visitor comes back", async () => {
    const link = stripeLink();
    const button = new FakeEl("stripe-buy-button");
    const { returnWith } = await runOn(await script(), {
      cookie: HELD,
      build: (b) => [link, button].forEach((el) => b.appendChild(el)),
    });
    returnWith(`${REFERRAL_COOKIE}=newer_token`);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}newer_token`);
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}newer_token`);
  });

  it("does not touch a Merchant's own value when the visitor comes back", async () => {
    const link = stripeLink("https://buy.stripe.com/test_abc?client_reference_id=user_42");
    const own = new FakeEl("stripe-pricing-table", { "client-reference-id": "user_42" });
    const { returnWith, click, setCookie } = await runOn(await script(), {
      cookie: HELD,
      build: (b) => [link, own].forEach((el) => b.appendChild(el)),
    });
    returnWith(`${REFERRAL_COOKIE}=newer_token`);
    setCookie(`${REFERRAL_COOKIE}=newest_token`);
    click(link);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe("user_42");
    expect(own.getAttribute("client-reference-id")).toBe("user_42");
  });

  it("keeps the fresh ?via= token when the cookie still holds an older one", async () => {
    // The script's own cookie write is blocked here (the fake jar ignores it),
    // so the older cookie stays in place; a click must not revert to it.
    const link = stripeLink();
    const button = new FakeEl("stripe-buy-button");
    const { click, returnWith } = await runOn(await script(), {
      search: "?via=sarah",
      cookie: HELD,
      blockCookieWrites: true,
      build: (b) => [link, button].forEach((el) => b.appendChild(el)),
    });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}fresh_token`);
    click(link);
    returnWith(HELD);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}fresh_token`);
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}fresh_token`);
  });

  it("still follows a genuinely newer cookie after a ?via= click", async () => {
    const link = stripeLink();
    const { click, setCookie } = await runOn(await script(), {
      search: "?via=sarah",
      cookie: HELD,
      blockCookieWrites: true,
      build: (b) => b.appendChild(link),
    });
    setCookie(`${REFERRAL_COOKIE}=newer_token`);
    click(link);
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}newer_token`);
  });

  it("writes nothing when the token is already current", async () => {
    const link = stripeLink(`https://buy.stripe.com/test_abc?client_reference_id=${REF}held_token`);
    const button = new FakeEl("stripe-buy-button", { "client-reference-id": `${REF}held_token` });
    let writes = 0;
    button.setAttribute = () => {
      writes++;
    };
    const before = link.getAttribute("href");
    const { click } = await runOn(await script(), {
      cookie: HELD,
      build: (b) => [link, button].forEach((el) => b.appendChild(el)),
    });
    click(link);
    expect(link.getAttribute("href")).toBe(before);
    expect(writes).toBe(0);
  });

  it("treats an empty client_reference_id as absent and tags the link", async () => {
    const link = stripeLink("https://buy.stripe.com/test_abc?client_reference_id=");
    await runOn(await script(), { cookie: HELD, build: (b) => b.appendChild(link) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe(`${REF}held_token`);
  });

  it("treats an empty client-reference-id on an embed as absent and tags it", async () => {
    const button = new FakeEl("stripe-buy-button", { "client-reference-id": "" });
    const table = new FakeEl("stripe-pricing-table", { "client-reference-id": "" });
    await runOn(await script(), { cookie: HELD, build: (b) => [button, table].forEach((el) => b.appendChild(el)) });
    expect(button.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
    expect(table.getAttribute("client-reference-id")).toBe(`${REF}held_token`);
  });

  it("keeps a non-empty value that only resembles ours", async () => {
    const link = stripeLink("https://buy.stripe.com/test_abc?client_reference_id=xsupaffi_abc");
    const own = new FakeEl("stripe-buy-button", { "client-reference-id": "SUPAFFI_abc" });
    await runOn(await script(), { cookie: HELD, build: (b) => [link, own].forEach((el) => b.appendChild(el)) });
    expect(new URL(link.href).searchParams.get("client_reference_id")).toBe("xsupaffi_abc");
    expect(own.getAttribute("client-reference-id")).toBe("SUPAFFI_abc");
  });
});
