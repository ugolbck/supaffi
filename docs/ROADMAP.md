# Roadmap

What is still missing, roughly in the order it gets built. Deliberately coarse:
this is the shape of the work, not a changelog. Shipped versions are in
CHANGELOG.md. The reasoning behind the current order is in
docs/ux-review/README.md.

## Now: UX

### Paying affiliates
The monthly payout is the job every owner repeats, and it is spread across a
tab, a list and a side panel. It gets a page of its own: one row per affiliate
with the amount, their payout method ready to copy, and Mark paid. Past
payouts are listed by payout, not by single commission.

### Phones
Onboarding and every table need a layout that fits a phone. Steps go above
the form, tables become lists, and the header says which product you are on.

### Dark mode
Follow the system setting on both the owner and affiliate sides.

### Charts
One series at a time with a hover value, colours that do not read as errors,
calmer lines on small numbers.

### Consistency
One form style, forms that keep what you typed after an error, money in the
interface font, one status badge, and branded pages for not found and
invite-only programs.

## Next

### What affiliates see
Their terms (rate, duration, cookie window, hold) on their dashboard and the
signup page, and a payout method picked from a short list instead of a free
text box.

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
