# Roadmap

Open work, roughly in the order it should be done. Shipped decisions live in
CONTEXT.md; this file is only what is still missing.

## Blocking a usable end-to-end run

### Owner cannot see a commission until it is payable
The owner's Commissions screen has two tabs, Payouts and Flagged, which query
`status: PAYABLE` and `status: FLAGGED`. A commission is created `PENDING` and
stays there for the holding period, so the first real sale is visible to the
affiliate and invisible to the owner. The worker sweep does promote
`PENDING` to `PAYABLE` on `payableAt`, so nothing is broken upstream; the owner
simply has no view of pending money.

Needs a third tab or a combined ledger showing every status with the date each
one becomes payable.

### Affiliates section is not built
The sidebar item is permanently locked. No owner-facing list of affiliates,
their referral codes, their per-affiliate override rate, or their earnings.

### Referral parameter should be `via`, not `ref`
`?ref=` is what analytics tools and generic referrer plumbing already use, so it
collides. Rewardful uses `?via=<code>` and that is the convention affiliates
recognise. Changing it touches `track.js`, `/api/track`, and every generated
link. Nothing is installed anywhere yet, so this is the moment to do it with no
migration path to maintain.

## Dashboard layout

### The screens do not read as a dashboard
They read as a marketing page dropped inside a dashboard shell: centred column,
a hard max width, most of the viewport unused, and cards that stretch to
absurd heights when their content is short. The Programs card on the product
overview is the clearest case.

Fix starts with wireframes, not with more CSS on the existing pages. One
wireframe per screen, checked against each other for coherence, then
implemented. Rules the wireframes have to satisfy:

- Fill the available width. No centred column with dead space either side.
- A card's height comes from its content, never from a grid row stretching it.
- Breadcrumbs already exist in the top bar and are not primary navigation.
- No page-level scroll. Anything unbounded scrolls inside its own region.

Screens in scope: products list, product overview, commissions, affiliates,
programs, integrations, tracking, and the four setup steps.

### Product id is visible in breadcrumbs and links
`/dashboard/products/cmtivutsa000206rusua5qfrm` is what the user reads in the
address bar and what the breadcrumb falls back to. Needs a slug on Merchant,
derived from the name and unique per owner, with the id kept internal.

### Setup progress shows after setup is done
Revisiting Integrations on a fully configured product still says "Step 1 of 4".
The step rail belongs to onboarding, so it should disappear once the product is
set up, leaving the page as a plain settings screen.

## Affiliate side

### The affiliate dashboard needs a rebuild
It does not share the owner dashboard's layout, typography, or components. It
also shows far less than an affiliate needs. Rewardful's affiliate view is the
reference: visitors, leads and conversions at the top; a links table with
per-link stats, copy, and edit; then commissions, payouts, referrals, and
assets as their own sections.

### Affiliates cannot manage their links
One link is generated at signup and cannot be changed. An affiliate should be
able to edit their code and create additional links, including links that point
at a specific page on the merchant's site rather than only the root.

## Known gaps, lower priority

- A session that outlives its Owner row still passes the dashboard guard and
  renders an empty dashboard instead of redirecting to login.
- The five `rk_` permission identifiers offered in the Stripe connect
  instructions have not been checked against the live key-creation form. Stripe
  ignores unknown identifiers silently, so a wrong one produces a key that
  fails at runtime with no signal at connect time.
- Owner login has no rate limiting. Each attempt costs 64 MiB of Argon2id.
