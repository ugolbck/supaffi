# Security policy

## Reporting a vulnerability

Report it privately through
[GitHub's private vulnerability reporting](https://github.com/ugolbck/supaffi/security/advisories/new).
Do not open a public issue, pull request or discussion for it.

Include what you can: the version, the steps to reproduce, and what an attacker
gains. A proof of concept helps but is not required.

You get a reply within 3 working days. Once the issue is confirmed, a fixed
release goes out and an advisory is published crediting you, unless you ask
not to be named.

## Supported versions

Only the latest release gets security fixes. Instances on an older version
update with the installer, as described in the README.

## Scope

In scope: this repository, the published image on `ghcr.io/ugolbck/supaffi`,
and the install script.

Out of scope: problems that need control of the server Supaffi runs on, or of
its `.env` file, and findings from automated scanners without a working attack.
