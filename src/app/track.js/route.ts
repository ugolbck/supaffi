import { NextRequest, NextResponse } from "next/server";

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
  const origin = req.nextUrl.origin;

  const script = `
(function () {
  var params = new URLSearchParams(window.location.search);
  var ref = params.get("ref");
  if (!ref) return;

  fetch("${origin}/api/track?ref=" + encodeURIComponent(ref))
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data || !data.referralToken) return;
      window.supaffi = window.supaffi || {};
      window.supaffi.referralToken = data.referralToken;
      // A generous fixed client-side lifetime, just so the browser doesn't
      // drop the cookie too early. The Attribution Window itself is
      // enforced server-side against Click.expiresAt when a purchase comes
      // in, not by this cookie's own duration.
      document.cookie =
        "supaffi_ref=" + data.referralToken +
        "; path=/; max-age=" + (60 * 60 * 24 * 90) + "; SameSite=Lax";
    });
})();
`.trim();

  return new NextResponse(script, {
    headers: { "Content-Type": "application/javascript; charset=utf-8" },
  });
}
