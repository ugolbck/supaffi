# Changelog

Every released version, newest first. The release workflow copies the section
for a version into its GitHub release, and the dashboard reads that back when
it checks whether a newer version exists. A `### Security` heading here is what
makes the dashboard's update notice loud rather than quiet, so the wording
below is not decoration.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
