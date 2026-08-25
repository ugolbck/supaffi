#!/usr/bin/env bash
set -euo pipefail

# One-command self-hosted install. Generates secrets, brings up app + Postgres + Caddy.
# Usage: curl -fsSL https://get.supaffi.com | bash

touch .env

# Per-key idempotent check rather than an all-or-nothing "only if .env is
# absent" — an existing install upgrading into a version that added a new
# secret (e.g. AUTH_SECRET) still needs that key appended, without
# regenerating (and thereby invalidating) secrets it already has.
grep -q '^MASTER_ENCRYPTION_KEY=' .env || echo "MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
grep -q '^POSTGRES_PASSWORD=' .env || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
grep -q '^AUTH_SECRET=' .env || echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env

docker compose up -d

echo "Supaffi is starting. Point a domain's DNS at this server's IP, then visit it to finish setup."
