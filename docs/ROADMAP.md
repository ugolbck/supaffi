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
