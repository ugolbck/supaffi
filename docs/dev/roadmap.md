# Roadmap, detailed

The working version of [docs/ROADMAP.md](../ROADMAP.md), for contributors. Same
order, with the technical notes, the work that runs alongside, and the known
gaps. Shipped versions are in CHANGELOG.md.

The order follows what makes a SaaS founder pass on Supaffi today, measured
against Rewardful, Tolt, FirstPromoter, Affonso and Dub Partners: sales it
cannot see first, then the work and fees of paying affiliates, then switching
costs, then the rest of the program.

## Up next

### Referrals keep their program's terms
Renewals and later payments read rate, duration and holding period from the
affiliate's current program, so moving an affiliate rewrites the terms of
customers they already referred. Record the program on the Click when it is
made and earn from that one.

### Forms that work with password managers
`autocomplete`, labels and error wiring on the login, password and settings
forms, on both sides of the app.

### Paddle
Polar shipped in 0.8.0 behind the provider layer (src/lib/payments/). Paddle
is a folder next to stripe/ and polar/ that passes the shared provider test
kit, plus a fake for the e2e suite.

## Planned

### Payouts
A minimum payout per program, below which an affiliate is not paid yet, and
the reason each commission is on hold: holding period, below the minimum, or
flagged. Recording a payout keeps its method, a reference and a note, and the
Payouts page gets filters. A payout file in the format PayPal and Wise accept
for bulk payouts. Paid tools charge 2 to 8% of payouts for this, or keep it
for their top plans.

### Commissions after fees
An option per program to earn on the sale minus the provider's fee. The fee is
stored on each payment as the provider reports it (Stripe's balance
transaction, Polar's order), with a fallback rate when it is not reported.

### Import from another tool
Affiliates, their links and their commission history from Rewardful, Tolt and
FirstPromoter: upload an export, preview it, map it to programs, import. Moving
costs nothing and nobody's link breaks.

### Applications and sales review
A program can hold new affiliates until the owner approves them, instead of
choosing between open to anyone and invite only. Sales that look like fraud
beyond a self-referral (many clicks from one address, disposable emails) are
held in the same flagged list for the owner to confirm or dismiss.

### Claude and ChatGPT connection
An MCP server so an owner can ask their AI assistant about the program and act
on it: top affiliates, what is owed, flagged commissions. Read first, then the
actions the dashboard already has. Tolt, FirstPromoter, Affonso, Partnero and
Dub all ship one.

### Fixed and tiered rewards
A flat amount per sale or per signup, and a higher rate once an affiliate
passes a sales volume.

## Later

### Tax forms
Affiliates upload their W-9 or W-8BEN in the portal, and the Payouts page shows
who is missing one.

### Lemon Squeezy
A provider folder next to Paddle's.

### A discount for the referred customer
Two-sided rewards: the customer who came through an affiliate gets a discount
on their purchase.

### Affiliate kit
The product's logo and colours on the affiliate pages, and banners, copy and
links ready to share from the affiliate dashboard.

### Alerts and webhooks
A message in Slack, or a webhook for Zapier, when an affiliate signs up, a sale
earns or a commission is flagged.

### Stats per link
Which of an affiliate's links and sources bring clicks and sales, on both
dashboards.

### Late refunds
A refund or chargeback that arrives after a commission was paid is the owner's
loss today. An optional setting could take it off the affiliate's next payouts
instead, for owners whose refund window is longer than their holding period.

### Stripe problems in the dashboard
A disabled webhook or events that keep failing reach only the server log
today. They should show in the dashboard.

## Alongside

### UX polish
Flagged commissions confirmed or dismissed on the row. Totals at the top of the
affiliate panel, with a way to all of their commissions, and a program change
that saves when picked. Tracking code blocks that show in full, larger hit
areas on small buttons, the product's name on the password page. The review
behind these is in docs/ux-review/README.md.

### Real Stripe test mode in CI
The browser tests run on every pull request against a fake Stripe. On main and
release tags they should also complete a real Checkout Session in test mode,
with Stripe's CLI forwarding webhooks, to catch Stripe API changes. Needs a
test-mode key as a repository secret, so it never runs on pull requests from
outside or from Dependabot. No scheduled runs.

### What cannot be tested
- Public DNS and certificate issuance from a real CA. Emulated locally.
- Stripe's hosted Checkout page, which blocks automation by design.
- Stripe reaching a public webhook URL over the internet.
- Stripe's real buy button and pricing table scripts. The e2e covers a Payment
  Link on the merchant's page; the embeds are covered by unit tests only.
- The merchant's own checkout code.
- Polar and Paddle sandboxes in CI: neither documents completing a checkout
  without a browser, and Paddle's simulator needs a public URL.
- Time passing (holding periods, renewals) without a fake clock or Stripe
  test clocks.
- Safari's cookie restrictions, only approximated.

## Known gaps

- Polar is pinned to API version 2026-10, on every request and on each
  webhook endpoint. Polar removes a version about nine months after it ships,
  so the move to 2027-01 has to land before about April 2027. Bumping
  `POLAR_API_VERSION` moves existing endpoints at the next start; the handlers
  must read the new payloads first.
- A session that outlives its owner account still passes the dashboard guard
  and renders an empty dashboard instead of sending you back to login.
- The Stripe restricted key permissions named in the connect instructions have
  not been checked against Stripe's live form. Stripe ignores an unknown one
  silently, so a wrong name produces a key that fails later with no warning at
  connect time.
- Credit notes credited to a customer's balance instead of refunded do not
  lower a commission.
- Payment Links on a merchant's own custom checkout domain are not tagged.
- Products sharing one Stripe account must not link to each other's Payment
  Links, buy buttons or pricing tables. A site's script tags every Stripe buy
  link on its pages, and Supaffi cannot tell which Stripe products belong to
  which of its products, so an affiliate of one could be credited for the
  other's sale.
- On the page a visitor lands on through an affiliate link, a buy link clicked
  before the click is recorded (a fraction of a second) goes untagged.
- A promo code only credits when used at checkout. One a customer adds later,
  in Stripe's customer portal or on a subscription through the API, earns
  nothing: invoices name their discounts only by Discount id, and reading the
  code behind one costs an expanded invoice read on every renewal.
- Products sharing one Stripe account see the same promotion codes. Giving the
  same code out on both credits an affiliate of each for one sale.
- Promo codes need a key with Coupons read and Promotion Codes write. An
  older key keeps earning on everything else, and the discount field or the
  first code action says to replace it. The `rak_coupon_read` and
  `rak_promotion_code_write` link tokens are unchecked like the others above.
- Promo codes, left for later: renaming a code once made (Stripe cannot change
  a code's text, so it means making a new one), a per-program switch to let
  existing customers use codes, expiry dates and usage caps, moving existing
  codes to a program's new coupon (they keep the discount they were made
  with), and telling the owner when an affiliate's claim fails on their key.
