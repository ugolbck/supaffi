# Roadmap

Open work, roughly in the order it should be done. Shipped decisions live in
CONTEXT.md; this file is only what is still missing.

## Missing screens

### Affiliates section is not built
The sidebar item is permanently locked. No owner-facing list of affiliates,
their referral codes, their per-affiliate override rate, or their earnings.

## Dashboard layout

### The screens do not read as a dashboard
Wireframes are done, in `docs/design/wireframes.md`. What follows is why.

They read as a marketing page dropped inside a dashboard shell: centred column,
a hard max width, most of the viewport unused, and cards that stretch to
absurd heights when their content is short. The Programs card on the product
overview is the clearest case.

Commissions is built to the wireframe and is the reference. Still to bring
across: products list, product overview, programs, and the settings form.
Affiliates gets built to it from scratch.

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
