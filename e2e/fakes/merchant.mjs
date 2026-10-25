// The merchant's own website, for the end-to-end suite only.
//
// It does what the onboarding tells a merchant to do: load track.js in the
// page head, and pass the referral cookie into the checkout as metadata. It
// also carries a Stripe Payment Link, which the owner leaves alone. The
// checkout itself is the fake Stripe's /_test/checkout, which stands in for a
// buyer paying on Stripe's hosted page.

import { createServer } from "node:http";

const PORT = Number(process.env.PORT ?? 8080);
const TRACK_ORIGIN = process.env.TRACK_ORIGIN ?? "https://go.shop.test";
const STRIPE = process.env.FAKE_STRIPE ?? "http://fake-stripe:12111";
const REFERRAL_COOKIE = "__supaffi_referral";
const REFERRAL_METADATA_KEY = "supaffi_referral";

const page = (body) => `<!doctype html>
<html><head><meta charset="utf-8"><title>Shop</title>
<script src="${TRACK_ORIGIN}/track.js" async></script>
</head><body>${body}</body></html>`;

const home = page(`<h1>Shop</h1>
<form method="post" action="/buy">
  <label>Email <input name="email" type="email" required></label>
  <button type="submit">Buy for $100</button>
</form>
<p><a data-testid="payment-link" href="https://buy.stripe.com/test_e2e">Pay with a Payment Link</a></p>`);

function cookie(req, name) {
  for (const part of (req.headers.cookie ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

createServer(async (req, res) => {
  const url = new URL(req.url, "http://shop");
  if (req.method === "POST" && url.pathname === "/buy") {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const email = new URLSearchParams(Buffer.concat(chunks).toString()).get("email");
    const token = cookie(req, REFERRAL_COOKIE);
    const checkout = await fetch(`${STRIPE}/_test/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ amount: 10000, currency: "usd", email, metadata: token ? { [REFERRAL_METADATA_KEY]: token } : {} }),
    }).then((r) => r.json());
    res.writeHead(200, { "content-type": "text/html" });
    return res.end(
      page(`<h1>Thanks</h1>
<p data-testid="payment-intent">${checkout.payment_intent}</p>
<p data-testid="referral">${token ?? "none"}</p>
<p data-testid="delivered">${checkout.deliveries.map((d) => d.status).join(",")}</p>`),
    );
  }
  res.writeHead(200, { "content-type": "text/html" });
  res.end(home);
}).listen(PORT, () => console.log(`merchant site on :${PORT}`));
