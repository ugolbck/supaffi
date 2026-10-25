# What Supaffi handles

Describes what Supaffi does today. This is the source for the docs site and the landing page's use-case list. If a behaviour is not listed under "What it solves reliably", Supaffi does not promise it. Fixes in each version are in the changelog, and what comes next is in the [roadmap](ROADMAP.md).

## Who it is for

A SaaS founder or small team that:

- sells subscriptions, and optionally one-time purchases, through **Stripe Checkout** started from their own site or app, or through **Stripe Payment Links**, buy buttons and pricing tables embedded on it;
- wants to reward affiliates with a **percentage of what customers actually pay**;
- pays affiliates **themselves**, by bank transfer, PayPal or similar, and records it in Supaffi;
- is comfortable running a server, or following a one-command install.

## What it solves reliably

### Setup

- One install runs several products, each with its own affiliate domain, Stripe account connection, program and affiliates.
- Stripe is connected with a restricted key, or a full secret key if you prefer. Supaffi creates the Stripe webhook itself and subscribes to exactly the events it needs.
- Several products can share one Stripe account without paying the wrong affiliate, as long as each runs on its own site.

### Tracking a referral

- Affiliates share links on your site, such as `yoursite.com/pricing?via=sarah`.
- A small script on your site remembers the referral. Your checkout code passes it to Stripe Checkout in the session metadata.
- Stripe Payment Links, buy buttons and pricing tables need no code of yours. The script adds the referral to them on your pages, including ones that appear after the page loads.
- The last affiliate link a visitor used gets the credit, as long as they buy within the attribution window you set, up to 90 days.

### Payments that earn a commission

- A one-time purchase through Stripe Checkout, or through a Payment Link, buy button or pricing table.
- The first payment of a subscription started through Stripe Checkout, or through a Payment Link, buy button or pricing table.
- Every later renewal of that same subscription, including upgrades and downgrades within the same Stripe product, until the commission duration ends.
- A free trial that converts: the commission starts at the first real payment.
- The duration counts once per referral. A customer who cancels and subscribes again through the same referral does not restart it. A new click on the affiliate's link is a new referral.
- Delayed payment methods such as SEPA or ACH debit: the commission is recorded once the money settles.

### How the commission is calculated

- A percentage set per program, with an optional custom rate per affiliate.
- Paid once, for a set number of months from the first payment, or for as long as the subscription pays.
- On the price after discounts, before tax and shipping.
- Only on what the customer actually paid. Parts covered by the customer's Stripe credit balance earn nothing.
- Only on the subscription the affiliate referred. One-off charges added to its invoices, manual invoices, and a switch to another Stripe product earn nothing.
- Only on money collected through Stripe. An invoice you mark as paid outside Stripe earns nothing for the part paid outside Stripe.
- In the currency of the sale. Amounts in different currencies are never converted or added together. Very large amounts, like the Vietnamese dong, are supported.
- A payment can be excluded from commissions by setting `supaffi` to `false`, in lowercase, in the metadata of the invoice, subscription or customer. Set it before the customer pays, for example in `subscription_data.metadata` when you create the Checkout Session. A flag added after payment excludes later renewals only. A one-time purchase can only be excluded through its customer or its post-purchase invoice.

### Protecting your money

- **Holding period.** A commission becomes payable only after the number of days you set, so most refunds land before you pay.
- **Refunds.** A full refund cancels the commission. A partial refund lowers it in proportion. A refund that reaches Supaffi before its sale still applies.
- **Refunds after you paid.** A paid commission is final. A refund or chargeback that arrives after you paid is your loss, and Supaffi never takes money back from the affiliate. The holding period is what protects you.
- **Disputes.** While a chargeback is open, its commission cannot be paid. If it is lost before you paid, the commission is cancelled. A won one releases the commission.
- **Self-referrals.** A sale is flagged when the buyer's email matches the affiliate's, or, when Stripe can show it, the card used matches a card on the affiliate's own Stripe customer. A flagged commission is never payable until you decide. Once you confirm a flag, or mark a referral as a self-referral yourself, everything unpaid from that referral is cancelled and it never earns again.
- **Cancellations.** Once a subscription ends, it earns nothing more. Commissions already earned stay.
- **Marking a payout paid.** You pay one affiliate in one currency at a time. Supaffi records exactly the commissions and amounts you saw, even if one was refunded after you opened the page, since you already sent that money. A page over an hour old has to be reloaded first. Sales that arrive meanwhile stay unpaid.
- **Stripe delivery problems.** Duplicate, late or out-of-order Stripe events never create a second commission. Failed processing is retried for about two days.

### Affiliates

- Sign up on a public page with an email and password. A forgotten password is reset with a link you copy from their panel and send them. Supaffi sends no email.
- See clicks, sales, earnings, what is pending, payable and paid, and their payout history.
- Create extra links pointing at any page of your site, and add their payout details.

## What it does not handle

These are outside the product on purpose. They may come later if users need them.

- **Payments that do not go through Stripe Checkout or a Payment Link:** custom Stripe Elements checkouts, invoices sent by hand, subscriptions created in the Stripe Dashboard or through the API without Checkout.
- **Payment Links on your own custom checkout domain.** The script only tags links that point to Stripe's own address.
- **Payment Links, buy buttons and pricing tables that already carry your own client reference.** The script leaves them alone, so sales through them are not tracked.
- **Other payment providers:** Paddle, Lemon Squeezy, PayPal, app stores.
- **Stripe Connect** platforms and marketplaces.
- **Sending money.** Supaffi records payouts. It never pays affiliates itself.
- **Tax forms and withholding** for affiliates, such as 1099 or W-8.
- **Fixed-amount commissions, tiers based on volume, minimum payout thresholds,** and multi-level or two-sided rewards such as a discount for the referred customer.
- **Commissions on signups, leads or free trials** that never pay.
- **Other attribution models,** such as first click, split credit, or coupon-code-only attribution.
- **Tracking across unrelated domains.** The script and your checkout must run on the same site.
- **Several products on the same site sharing one Stripe account.** A referral for one product can be credited on the other's sale.
- **Approving affiliates.** An affiliate's link works as soon as they sign up. A program's public signup can be turned off, and you then move affiliates into it yourself.
- **Currencies without decimals,** like the yen. Commissions are calculated and shown with two decimals.
- **Failed payments and paused subscriptions.** A failed or paused invoice simply earns nothing, and nothing is shown about it.
- **Add-ons sold as a separate Stripe product** on an existing subscription. Only the products bought through the referral earn.
- **Recovering refunds after payout** from the affiliate's future commissions. Planned as an optional setting.
- **Credit notes credited to a customer's balance** instead of refunded. They do not lower a commission yet.
- **Separate test and live modes.** Use a separate product for testing.
- **Warnings in the dashboard for a disabled webhook or Stripe events that failed.** These are written to the server log. A revoked key does show in the dashboard.
