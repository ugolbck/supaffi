# Roadmap

What is still missing, roughly in the order it gets built. Deliberately coarse:
this is the shape of the work, not a changelog. Shipped versions are in
CHANGELOG.md. The UX review behind the current order is in
docs/ux-review/README.md.

## Now: UX polish

### Flagged commissions
Confirm and dismiss on the row, with the buyer and the affiliate side by side,
instead of inside the commission's panel.

### The affiliate panel
Totals at the top (earned, paid, owed) and a way to every commission of that
affiliate. A program change that saves when picked.

### Small details
Tracking code blocks that show in full, headings that wrap evenly, larger hit
areas on small buttons, the product's name on the password page.

## Now: testing the affiliate chain end to end

Unit tests already cover each handler with Stripe stubbed. What nothing
checks is the whole chain on a running install: affiliate link, tracking
script, cookie, checkout, webhook, worker, commission on both dashboards.

### v1: every pull request, no secrets
The production image, Caddy and Postgres, plus a fake merchant site and a
small stateful fake Stripe that signs and sends webhooks the way Stripe does.
Hostnames like go.shop.test resolve only inside the test and Caddy issues
local certificates, so the app takes its production paths, not the local ones.
A browser walks owner setup, onboarding, affiliate signup, the link, the
purchase, then a refund, a dispute and a self-referral. The sale step is
written without naming Stripe, so Polar and Paddle each only need a fake.

### v2: real Stripe test mode, on main and release tags
Stripe's CLI forwards webhooks and completes a real Checkout Session carrying
a referral. Catches Stripe API changes. Needs a test-mode key as a repository
secret, so it never runs on pull requests from outside or from Dependabot.
No scheduled runs.

### What cannot be tested
- Public DNS and certificate issuance from a real CA. Emulated locally.
- Stripe's hosted Checkout page, which blocks automation by design.
- Stripe reaching a public webhook URL over the internet.
- The merchant's own checkout code.
- Polar and Paddle sandboxes in CI: neither documents completing a checkout
  without a browser, and Paddle's simulator needs a public URL.
- Time passing (holding periods, renewals) without a fake clock or Stripe
  test clocks.
- Safari's cookie restrictions, only approximated.

### Also worth building
A "Send a test sale" check in the product, run against the owner's own Stripe
test mode, so a self-hoster can prove their own install end to end.

## Later

### More providers
Stripe is the only payment provider. Paddle and Polar are the obvious next
ones.

### Recovering late refunds
A refund or chargeback that arrives after a commission was paid is the owner's
loss today. An optional setting could take it off the affiliate's next payouts
instead, for owners whose refund window is longer than their holding period.

## Known gaps

- A session that outlives its owner account still passes the dashboard guard
  and renders an empty dashboard instead of sending you back to login.
- The Stripe restricted key permissions named in the connect instructions have
  not been checked against Stripe's live form. Stripe ignores an unknown one
  silently, so a wrong name produces a key that fails later with no warning at
  connect time.
