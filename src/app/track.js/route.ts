import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { REFERRAL_COOKIE, REFERRAL_QUERY_PARAM } from "@/lib/referral";
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
  if (!code) return;

  // Sends back the token this browser already holds, read by exact cookie
  // name, so a reload keeps its Click rather than starting a new referral.
  var held = document.cookie.split("; ").filter(function (c) {
    return c.indexOf(${JSON.stringify(`${REFERRAL_COOKIE}=`)}) === 0;
  })[0];
  var token = held ? held.slice(${JSON.stringify(`${REFERRAL_COOKIE}=`)}.length) : "";

  fetch(${trackUrl} + encodeURIComponent(code) + (token ? "&token=" + encodeURIComponent(token) : ""))
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !data.referralToken) return;
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
