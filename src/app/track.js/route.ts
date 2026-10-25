import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { REFERRAL_CLIENT_REFERENCE_PREFIX, REFERRAL_COOKIE, REFERRAL_QUERY_PARAM } from "@/lib/referral";
import { originFor } from "@/lib/url";

// Served at /track.js on the Merchant's own Supaffi domain, embedded on
// the Merchant's actual site with a plain <script src="..."> tag — a
// third-party script like Google Analytics or Meta Pixel (see CONTEXT.md:
// cookie consent is the Merchant's responsibility, same as any other
// third-party script, not something Supaffi builds a consent API for).
//
// Baking the origin in at serve time, rather than relying on
// document.currentScript, since that only works reliably for a plain,
// synchronously-loaded <script> tag and breaks if the Merchant loads it
// any other way (async, dynamically injected, through a tag manager).
export async function GET(req: NextRequest) {
  // The Host header only selects a Merchant; the origin written into the
  // script comes from that Merchant's stored domain. Pasting request headers
  // into JavaScript let anyone who could influence them (or a cache keyed
  // without them) serve script that runs on a Merchant's site. X-Forwarded-Proto
  // is ignored for the same reason: originFor already knows the scheme.
  const host = req.headers.get("host");
  const merchant = host
    ? await db.merchant.findUnique({ where: { domain: host }, select: { domain: true } })
    : null;
  if (!merchant) {
    return new NextResponse(null, { status: 404 });
  }

  const trackUrl = JSON.stringify(`${originFor(merchant.domain)}/api/track?${REFERRAL_QUERY_PARAM}=`);

  const script = `
(function () {
  var params = new URLSearchParams(window.location.search);
  var code = params.get(${JSON.stringify(REFERRAL_QUERY_PARAM)});

  // The token this browser already holds, read by exact cookie name. Sent
  // back to /api/track so a reload keeps its Click rather than starting a new
  // referral, and re-read later so a newer affiliate click is picked up.
  function readHeld() {
    var held = document.cookie.split("; ").filter(function (c) {
      return c.indexOf(${JSON.stringify(`${REFERRAL_COOKIE}=`)}) === 0;
    })[0];
    return held ? held.slice(${JSON.stringify(`${REFERRAL_COOKIE}=`)}.length) : "";
  }
  var token = readHeld();
  // The cookie value last seen or written by this script. A re-read only moves
  // the links when the cookie has changed since, so a fresh token whose cookie
  // write was blocked (or shadowed by a same-named cookie) is not undone by
  // reading back the older value.
  var seen = token;

  // Checkouts Stripe builds without the Merchant's code (Payment Links, buy
  // buttons, pricing tables) have no place for metadata, so they carry the
  // token in client_reference_id. An empty value counts as absent, and one
  // carrying our prefix is ours to keep current (last click wins). Any other
  // value is the Merchant's own and is never overwritten.
  function tag(el) {
    var name = el.tagName.toLowerCase();
    var ref = ${JSON.stringify(REFERRAL_CLIENT_REFERENCE_PREFIX)} + token;
    function taken(cur) {
      return !!cur && cur.indexOf(${JSON.stringify(REFERRAL_CLIENT_REFERENCE_PREFIX)}) !== 0;
    }
    if (name === "a") {
      var url;
      try { url = new URL(el.href); } catch (e) { return; }
      var cur = url.searchParams.get("client_reference_id");
      if (url.hostname !== "buy.stripe.com" || taken(cur) || cur === ref) return;
      url.searchParams.set("client_reference_id", ref);
      el.href = url.href;
    } else if (name === "stripe-buy-button" || name === "stripe-pricing-table") {
      var attr = el.getAttribute("client-reference-id");
      if (taken(attr) || attr === ref) return;
      // Both components watch this attribute and forward a changed value to
      // their checkout, so setting it is enough even once they have rendered.
      el.setAttribute("client-reference-id", ref);
    }
  }

  function scan(root) {
    if (root.nodeType !== 1) return;
    tag(root);
    var found = root.querySelectorAll('a[href*="buy.stripe.com"], stripe-buy-button, stripe-pricing-table');
    for (var i = 0; i < found.length; i++) tag(found[i]);
  }

  // Picks up a newer click made in another tab since this page loaded.
  function refresh() {
    var t = readHeld();
    if (!t || t === seen) return;
    seen = t;
    if (t === token) return;
    token = t;
    scan(document.documentElement);
  }

  function run(t) {
    if (!t) return;
    token = t;
    scan(document.documentElement);
    // Elements added later (single-page apps, async embeds) get tagged too.
    if (window.MutationObserver) {
      new MutationObserver(function (records) {
        for (var i = 0; i < records.length; i++) {
          for (var j = 0; j < records[i].addedNodes.length; j++) scan(records[i].addedNodes[j]);
        }
      }).observe(document.documentElement, { childList: true, subtree: true });
    }
    // Coming back to a page left open (or restored from the back button)
    // re-reads the cookie, since a newer affiliate click may have replaced it.
    document.addEventListener("visibilitychange", refresh);
    // A link whose href changed after load still carries the reference.
    ["click", "auxclick"].forEach(function (type) {
      document.addEventListener(type, function (e) {
        refresh();
        for (var n = e.target; n; n = n.parentNode) {
          if (n.nodeType === 1 && n.tagName.toLowerCase() === "a") return tag(n);
        }
      }, true);
    });
  }

  // Without ?via= the held token is all there is. With it, the fresh token
  // replaces the held one, so links are tagged once it has arrived.
  if (!code) return run(token);

  fetch(${trackUrl} + encodeURIComponent(code) + (token ? "&token=" + encodeURIComponent(token) : ""))
    .then(function (res) { return res.ok ? res.json() : null; })
    .catch(function () { return null; })
    .then(function (data) {
      if (!data || !data.referralToken) return run(token);
      window.supaffi = window.supaffi || {};
      window.supaffi.referralToken = data.referralToken;
      // A generous fixed client-side lifetime, just so the browser doesn't
      // drop the cookie too early. The Attribution Window itself is
      // enforced server-side against Click.expiresAt when a purchase comes
      // in, not by this cookie's own duration.
      //
      // SameSite=Lax, never None: this cookie is only ever read first-party,
      // by the Merchant's own checkout code on their own domain. Secure is
      // added only over HTTPS, because a Secure cookie on a plain-HTTP dev
      // site is silently dropped and tracking would fail with no error.
      document.cookie =
        ${JSON.stringify(`${REFERRAL_COOKIE}=`)} + data.referralToken +
        "; path=/; max-age=" + (60 * 60 * 24 * 90) +
        "; SameSite=Lax" +
        (window.location.protocol === "https:" ? "; Secure" : "");
      seen = readHeld();
      run(data.referralToken);
    });
})();
`.trim();

  return new NextResponse(script, {
    headers: {
      "Content-Type": "application/javascript; charset=utf-8",
      // Short enough that a changed or removed Merchant domain stops being
      // served within the hour. Vary on Host because one instance answers
      // for every Merchant, and a shared cache must not hand one Merchant's
      // script to another's site.
      "Cache-Control": "public, max-age=3600",
      Vary: "Host",
    },
  });
}
