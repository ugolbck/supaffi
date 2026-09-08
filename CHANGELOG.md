# Changelog

Every released version, newest first. The release workflow copies the section
for a version into its GitHub release, and the dashboard reads that back when
it checks whether a newer version exists. A `### Security` heading here is what
makes the dashboard's update notice loud rather than quiet, so the wording
below is not decoration.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
