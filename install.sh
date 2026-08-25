#!/usr/bin/env bash
set -euo pipefail

# One-command self-hosted install. Generates secrets, brings up app + Postgres + Caddy.
# Usage: curl -fsSL https://get.supaffi.com | bash

if [ ! -f .env ]; then
  echo "MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)" > .env
  echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
fi

docker compose up -d

echo "Supaffi is starting. Point a domain's DNS at this server's IP, then visit it to finish setup."
