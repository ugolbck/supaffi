# Roadmap, detailed

The working version of [docs/ROADMAP.md](../ROADMAP.md), for contributors. Same
order, with the technical notes, the work that runs alongside, and the known
gaps. Shipped versions are in CHANGELOG.md.

The order follows what makes a SaaS founder pass on Supaffi today, measured
against Rewardful, Tolt, FirstPromoter and Affonso: sales it cannot see first,
then switching costs, then the rest of the program.

## Up next

### Promo codes
Creators promote with a discount code, not a link. A Stripe promotion code
assigned to an affiliate credits them when a customer uses it, with or without
a click. Open questions before building: which Stripe permission reading the
code on a Checkout Session needs (existing restricted keys may lack it), and
which affiliate wins when a code and a link point to different ones.

## Planned

### Polar and Paddle
Founders who let a merchant of record handle sales tax cannot use Supaffi.
Polar and Paddle first, Lemon Squeezy after. The e2e sale step is already
written without naming Stripe, so each needs only a fake.

### Import from another tool
Affiliates, their links and their commission history from Rewardful, Tolt and
FirstPromoter, so moving costs nothing and nobody's link breaks.

### Affiliate notifications
Tell affiliates when they earn and when they are paid, and let them reset their
own password. Optional: the owner brings a mail server, and without one
nothing changes.

### Bulk payouts
A payout file in the format PayPal and Wise accept for bulk payouts, from the
Payouts page, and a minimum amount below which an affiliate is not paid yet.

### Applications
A program can hold new affiliates until the owner approves them, instead of
choosing between open to anyone and invite only.

## Later

### Fixed and tiered rewards
A flat amount per sale or per signup, and a higher rate once an affiliate
passes a sales volume.

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

- A session that outlives its owner account still passes the dashboard guard
  and renders an empty dashboard instead of sending you back to login.
- The Stripe restricted key permissions named in the connect instructions have
  not been checked against Stripe's live form. Stripe ignores an unknown one
  silently, so a wrong name produces a key that fails later with no warning at
  connect time.
- Credit notes credited to a customer's balance instead of refunded do not
  lower a commission.
- Payment Links on a merchant's own custom checkout domain are not tagged.
- On the page a visitor lands on through an affiliate link, a buy link clicked
  before the click is recorded (a fraction of a second) goes untagged.
