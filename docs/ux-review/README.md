# UX review, 0.3.0

24 Oct 2026. Production build, a fresh install taken through setup and onboarding, then two seeded products with nine months of history (Instant Gradient: 16 affiliates, 343 commissions in USD; Mockit: 4 affiliates, one-time sales in EUR). Every screen captured at desktop (1440) and phone (390) size, in light and dark. Screenshots are in `screens/`, phone ones start with `m-`.

Benchmarks: Dub Partners and Rewardful for the affiliate category; Plausible, Umami, Cal.com and Coolify for self-hosted polish; Stripe and Linear for dashboards.

Not real problems: the red "points at another server" and "Stripe rejected the key" on Settings come from the fake domains and keys. "Script not found" on Tracking is partly the same, see point 9.

## Fix first

1. **Paying affiliates is buried.** It's the one job an owner does every month. Today it means: Commissions, then the Payable tab, scroll past a list of single commissions to "Ready to pay", then open each affiliate in another panel to find their PayPal or IBAN. Dub and Rewardful give it a page of its own: one row per affiliate with amount, payout method and a copy button, plus Mark paid. Paid payouts should be listed by payout too (date, affiliate, total), not as 188 single commissions. `44-commissions-payable`, `44-commissions-paid`
2. **Phones are broken.** Onboarding keeps its step list beside the form, so the page is twice the screen width (`m-05`, `m-09`). Tables get cut off: on Commissions the status is hidden, tabs and search are clipped, and Affiliates scrolls sideways (`m-22`, `m-23`). The phone header shows only a sidebar icon, with no product name. Plausible, Umami and Cal.com all work on a phone. Fix: put the steps above the form, and show tables as lists of cards on small screens.
3. **No dark mode.** A dark system setting changes nothing (`d-21`). Every benchmark has it, and the colours are already tokens, so it's mostly wiring plus a pass over the chart and status colours.
4. **Forms throw away what you typed.** A wrong setup token or a wrong owner password clears every field, email included (`02`, `51`). Affiliate login keeps it, so the two behave differently. The onboarding website field rejects `pagecast.app` with the browser's own popup (`04b`); accept it and add `https://`.
5. **The chart is hard to read.** Revenue bars are red, the colour used for errors, and they sit next to a red self-referral alert. There are two axes and no legend, the pale dashed top of each bar is never explained, and the smoothed clicks line spikes and dips on low numbers (`21`, `66`). Plausible and Stripe: one series at a time with a metric toggle, a tooltip on hover, neutral or brand colour for money, straight or monotone lines, weekly buckets when numbers are small.
6. **Machine data where people expect human data.** The commissions "Sale" column shows Stripe invoice IDs (`23`): replace it with the sale amount and a small "open in Stripe" link. On the affiliate side the sale price is struck through under the commission (`68`), which reads like a discount; write "of a $12 sale" instead.
7. **Affiliates can't see their deal.** Nowhere in their dashboard do they see the rate, the duration, the cookie window or the hold. Payout details are a large free-text box (`69`). Rewardful and Dub show the terms on the dashboard and ask for a payout method from a short list (PayPal, Wise, bank) with one field each.
8. **Dead ends.** A closed program's signup link is Next's default 404 (`63`). An owner page on a product domain is a blank white page (`52`). The general 404 is unbranded (`53`). Each should be a small Supaffi-styled page that says what happened and links somewhere useful ("This program is invite only. Already a member? Log in").
9. **Status that contradicts itself.** Tracking says "Script not found" in orange while 655 clicks came in this month and the sidebar dot is green (`27`). Clicks arriving prove the script works, so show that. In onboarding, the tracking check is red before the owner has had time to paste anything (`10`); start it grey ("Waiting").
10. **Two form styles.** Onboarding, the program editor and signup use grey label bands like a spreadsheet (`09`, `25`). Settings, account and the login pages use rounded inputs with labels on the side (`30`, `33`). Pick one; the label-above, rounded-input style is closer to Cal.com and Linear and works on phones.

## Screen by screen

| Screen | Cut | Missing | Looks better if |
| --- | --- | --- | --- |
| Setup `01` | "Owner" and "Instance" capitalised like terms | Logo; password rules shown up front | Card centred on phone, not halfway down (`m-01`) |
| Onboarding product `03` | | Accepts a bare domain | Name and website use the same font (website is monospace) |
| Onboarding subdomain `05b` | | "Takes a few minutes, you can continue" next to Continue | Grey and green ticks in the step list mean different things with no hint (`07`) |
| Onboarding Stripe `08` | | A note that a test key works for a dry run | Continue sits beside the field like a search bar; put it under |
| Onboarding terms `09` | Grey label bands | A worked example: "On a $29 plan an affiliate earns $8.70 a month" | Write the terms as one sentence with inputs inline |
| Onboarding tracking `10` | First comment in the checkout code repeats the line above it | Tabs for the usual setups (Next.js, Express, Payment Links) | Neutral check state before the first look |
| All products `20` | | Total owed across products, per currency | Pagecast shows "0.00 owed" with no currency; status as a proper badge; favicons instead of "IN", "MO", "PA" (Instant Gradient should be "IG") |
| Overview `21` | "How things went, last 30 days" repeats the range picker | Hover values on the chart | See point 5; the attention panel is good, keep it |
| Affiliates `22` | The three stat cards repeat Overview | Sort by earned (newest first today); add an affiliate by hand | Numbers in the normal font with even-width digits, not monospace; "$0.00" not "0.00"; "3/3" not "3 of 3 still paying"; no year on this year's dates |
| Affiliate panel `40` | | Totals at the top (earned, paid, owed); link to all their commissions | Program change saves on select, no separate Change button |
| Commissions `23` | Status chip and "Payable 23 Nov" say the same thing twice | | Search placeholder "payment referer" is jargon and misspelt |
| Flagged `44-flagged` | | Buyer and affiliate shown side by side with Confirm and Dismiss on the row | Full reason visible, not cut off |
| Programs `24` | | | Good. "EARN" label in capitals is the only odd bit |
| Program editor `25` | Grey bands | | The duration dropdown text is cut off ("for a number of mon") |
| Tracking `27` | | | Code block cut off inside its card; let it grow |
| Settings `30` | "Replace" on the webhook row | | Subdomain field has no label of its own; the label sits next to the status box |
| Account `33` | | | Update check says "off. Set SUPAFFI_UPDATE_CHECK=off to turn it off" when it is already off |
| Owner login `50` | | | The glow sits in the top third while the card is centred; same card as the affiliate login |
| Affiliate login `60` | | Product logo or name as the heading | Card pinned to the top while owner login is centred |
| Affiliate signup `61` | Grey "Sign up" band | Cookie window, hold and payout schedule beside the rate; logo | The referral link prefix is cut to "instantgradient.com/?vi…" so you can't see what you're typing into (`62`); "Log in instead" should be a link |
| Set password `64` | | Which product and which account this is for; password rules | |
| Affiliate overview `66` | Same subtitle as the owner side | Their terms (point 7) | Payable in blue and Paid in green; the owner side uses neither |
| Affiliate links `67` | | QR code or short share text per link | Good as is |
| Affiliate payouts `69` | "09:00" on every payment | When the next payment usually happens | Structured payout method instead of the large text box |

## Small details that add up

| Detail | Now | Better |
| --- | --- | --- |
| Money and counts | Monospace font (`$4.80`) reads like code | UI font with tabular figures, as in the Stripe dashboard |
| Status words | "pending", "voided" lowercase in panels, "Pending" chips elsewhere | One badge component everywhere |
| Nested corners | Big rounded cards around fully round inputs (setup, logins) | Outer radius = inner radius + padding |
| Headings on phone | "Point a / subdomain here" breaks badly | Balanced wrapping on headings |
| Small buttons | Copy, Edit, Set are about 24px tall | At least 40px hit area, 44px on phone |
| Product switcher | Shows a product while on All products and Account | Show "All products" there |
| Press feedback | None on buttons | Slight scale on press |

## What to build, in order

1. A payouts page (point 1).
2. Phone layouts for onboarding and every table (point 2).
3. Dark mode (point 3).
4. Chart rework (point 5).
5. Forms that keep input, one form style, and the copy fixes in the tables above (points 4, 6, 10).
6. Affiliate terms card and structured payout method (point 7).
7. Branded not-found and invite-only pages (point 8).
