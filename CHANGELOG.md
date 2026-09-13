# Changelog

Every released version, newest first. The release workflow copies the section
for a version into its GitHub release, and the dashboard reads that back when
it checks whether a newer version exists. A `### Security` heading here is what
makes the dashboard's update notice loud rather than quiet, so the wording
below is not decoration.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## 0.2.5

### Fixed

- When several products share one Stripe account, a renewal now pays only the
  affiliate who referred that specific subscription, not whoever referred the
  same customer to a different product.
- A subscription that did not start through a referred checkout, such as one
  created directly in the Stripe Dashboard, never earns a commission.
- Programs that pay for a set number of months count them from the
  subscription's first payment. A payment made by bank transfer or direct
  debit, which can take days to clear, is counted from the day it actually
  arrived rather than the day it was started.
- A one-time commission is paid on the first real payment after a free trial.
- Every renewal paid with a card that matches one of the affiliate's own
  Stripe customers is flagged for review, not only the first purchase.
- Cancelling a subscription marks only that product's referral as cancelled.
  Other subscriptions the same referral brought keep paying.
- Referrals made before this update are recognised the first time one of
  their invoices arrives. One that was still in a free trial, with no
  commission recorded yet, will not start earning renewals.

### Changed

- Confirming a self referral now cancels every commission from that referral
  that has not been paid yet, and stops it earning anything later. Commissions
  already paid are left as they are. The button says so.
- Self referrals confirmed before this update have their unpaid commissions
  cancelled by the update itself.

## 0.2.4

### Security

- Replace your Stripe key once: open Settings, press Replace on the Stripe key
  row and create the new key from the button there. The new key can also read
  charges, which Supaffi uses to catch refunds made right after a sale. Until
  you replace it, everything keeps working as it did.

### Fixed

- Commissions are worked out on the price before tax and shipping, whether
  your prices include tax or add it at checkout. Discounts still lower it.
- Revenue on the overview follows the same rule. Sales recorded before this
  version keep the figures they had, so a period that spans the update can
  look a little lower than the one before it.
- A first purchase or a renewal that comes to nothing, or is paid from the
  customer's credit balance, no longer adds an empty commission. A renewal
  paid partly from that balance now earns only on the part actually paid.
- A refund that reaches Supaffi before the sale it belongs to still lowers or
  cancels that sale's commission.
- A commission cancelled by a lost chargeback now says so plainly, for you
  and for the affiliate.
- Very large sales in currencies such as the Vietnamese dong or the
  Indonesian rupiah are recorded instead of failing.
- A sale whose tax cannot be read earns nothing rather than a wrong amount,
  and is noted in the server log.

### Changed

- If Supaffi cannot add the missing events to a product's webhook when it
  starts up, it now writes that to the server log instead of showing a
  warning in the dashboard.

## 0.2.3

### Security

- Webhook events interrupted by a restart are picked up again, and failing
  events are retried for about two days instead of eight minutes, so sales and
  refunds are no longer lost.
- A checkout paid by a delayed method, such as a bank debit, only earns a
  commission once the payment actually succeeds. Existing Stripe connections
  get the extra events added automatically at startup.
- A lost chargeback takes the commission back, the same way a full refund does.
- A sale on one product can no longer earn a commission for another product's
  affiliate.
- Paying, voiding and refunds landing at the same moment can no longer leave a
  commission in the wrong state, and refunds arriving out of order can no
  longer raise a commission back up.
- Owner login limits can no longer be bypassed, used to crash the server, or
  used by a stranger to lock the owner out.
- Login and signup emails to affiliates are rate limited, and a login link is
  only used when the affiliate presses Log in, so email scanners no longer
  spend it.
- A renamed or deleted referral code can no longer be claimed by another
  affiliate.
- The tracking script and click endpoint are hardened and rate limited, and the
  dashboards can no longer be embedded in another site.

### Fixed

- Long lists show a short run of page numbers instead of every page.
- The payable tabs list sales before the refund adjustments against them.

### Added

- Every figure on the overview says how it compares with the period before,
  in green, red or grey.
- A top affiliates card on the owner's overview, with a bar under each name
  showing how close they are to the leader.

### Changed

- The timeframe is chosen once, at the top of the overview, and every figure,
  the chart and the top affiliates follow it.
- The owner's Signups figure is gone. It counted affiliates joining, which read
  like customers. Revenue takes its place.
- What needs your attention is a set of cards you can open, and a commission
  flagged as a possible self referral stands out in red.
- Amounts are written with their currency symbol and thousands separators,
  and every total leads with the currency the chart is drawn in.
- The chart's bars and line animate in again whenever the timeframe changes.
- A tighter, even margin around the sidebar and the content, one corner
  rounding everywhere, and reworked product and account menus. The account
  menu now shows the version and whether an update is available.
- Both dashboards stack and scroll properly on phones and tablets.

## 0.2.2

### Added

- A chart on both dashboards: the clicks affiliates sent, over the money those
  clicks turned into. The owner's bars are the sale with the commission drawn
  on top of what they keep, so one bar says both what came in and what it
  cost. Eight windows to choose from, by the hour for a single day and by the
  month for a year, kept in the address so a reload and a shared link land on
  the same view.
- A currency switcher, for the rare product that sells in more than one. Money
  is never added across currencies, so the bars draw one and the tooltip lists
  the rest.
- A command that fills an instance with demo traffic, for looking at the
  dashboards before a product has any.

### Changed

- Setting up is six steps instead of nine. The webhook screen is gone: the key
  is made from a link that already grants what is needed, and saving it creates
  the endpoint. The two Resend screens are one, because both halves are done in
  the same browser tab in one sitting. The rail no longer counts the install and
  the account as steps, which only made the flow look longer than it is.
- Setup screens appear at once and fill their lights in behind you. Pressing
  Continue used to hold the button down for a few seconds, with nothing on
  screen to say why.
- Both dashboards sit on a grounded sidebar with the content floating above it,
  and every card has real depth rather than a hairline on white.
- The address proposed for a new product is now `go.` rather than `affiliates.`,
  which is shorter in every affiliate link and stops the login emails going out
  from `affiliates@affiliates.yoursite.com`.
- What can be paid is a list rather than a row of buttons, so an affiliate owed
  in two currencies reads as two payouts rather than a duplicate.

### Fixed

- A tick on the setup rail now means the check passed. Walking past a step used
  to be enough to mark it done, so a deleted record and a sending domain that
  was never added both read as finished.
- The certificate check no longer fails on hosts that cannot route a request
  from the server back to its own address. The site was reachable from
  anywhere on the internet and the instance alone could not see it.
- Voided commissions and refund adjustments no longer count as sales, which
  could leave a day showing a sale with no money against it.
- Checks against Stripe and Resend give up rather than hanging, so a screen
  cannot be left saying "checking" until it is reloaded.
- Every check that runs now writes a line to the log, with how long the outside
  world took to answer. A self-hosted instance had no way to see any of it.

## 0.1.1

### Fixed

- Updating stopped silently after taking its backup and applied nothing. The
  install script is piped into a shell, so the shell reads it from standard
  input, and the backup step attached the database container to that same
  input and consumed the rest of the script. Nothing was printed and nothing
  was broken, but the instance stayed on the version it was already running.
  Fresh installs were never affected, since only an update takes a backup.

## 0.1.0

First release.

### Added

- One command self-hosted install. It asks nothing, installs Docker if it is
  missing, works out whether it can own ports 80 and 443, and prints an address
  and a setup token.
- The dashboard is served over HTTPS on the server's own address, so a fresh
  install is reachable with no domain and no DNS record.
- A setup token, so a stranger who finds the server first cannot claim it.
- Affiliate programs, each on its own hostname, with certificates issued
  automatically on first request.
- Stripe ingestion: sales are attributed to affiliates and become commissions
  after the holding period.
- Affiliate signup, magic link login, referral links, and an affiliate
  dashboard.
- Rate limiting on owner login, which matters because the login form now sits
  on a public address.
- Published images for Intel and ARM servers, so nothing is compiled on the
  operator's machine.
