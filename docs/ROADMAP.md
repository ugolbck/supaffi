# Roadmap

What is still missing, roughly in the order it gets built. Deliberately coarse:
this is the shape of the work, not a changelog. Shipped versions are in
CHANGELOG.md.

## Now

### Installing next to what you already run
A server with nothing on it is handled. A server that already runs a reverse
proxy is not, quite: Supaffi stays out of the way as it should, but the program
hostnames still need a routing rule added by hand, and nothing in the product
tells you that or checks whether it worked. Both cases should be equally
automatic.

### Onboarding
The install is good and everything after it is not. Setup should be one path
that holds you until it is finished, rather than a dashboard you can wander
into half configured. That includes real guidance for the subdomain each
program needs, making Stripe progress visible step by step,
and rewriting the commission terms screen, which currently explains nothing.

## Next

### The affiliate side
The affiliate dashboard needs rebuilding. It should be somewhere affiliates
want to open, not only somewhere they go when chasing a payment. They also
cannot manage their own links yet: one is generated at signup and that is all
they get.

### The owner's view of affiliates
The affiliates section is not built. There is no list of who is promoting a
product, what they have earned, or per-affiliate rates.

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
