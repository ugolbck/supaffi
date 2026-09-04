#!/usr/bin/env bash
set -euo pipefail

# One-command self-hosted install.
#   curl -fsSL https://get.supaffi.com | sudo bash
#   curl -fsSL https://get.supaffi.com | sudo SUPAFFI_DOMAIN=supaffi.example.com bash
#
# The variable goes on `bash`, not on `curl`: putting it before curl sets it
# for the download, not for this script.
#
# Clones the repo rather than pulling a published image, so the whole stack
# (compose file, Caddyfile, Dockerfile, migrations) is actually present on the
# box. Costs a build on first install, roughly 2 GB of memory and a few
# minutes. A published image and a `docker compose pull` update path is the
# planned follow-up.

REPO="${SUPAFFI_REPO:-https://github.com/ugolbck/supaffi.git}"
DIR="${SUPAFFI_DIR:-/opt/supaffi}"
MIN_DOCKER_MAJOR=24

die() { printf '%s\n' "$*" >&2; exit 1; }
say() { printf '%s\n' "$*"; }

# Under `curl | bash` stdin is the script itself, so every question reads from
# the controlling terminal instead. Absent one (CI, a provisioning script),
# there is nothing to ask and each caller decides its own default.
has_tty() { [ -r /dev/tty ] && [ -w /dev/tty ]; }

ask() {
  local answer=""
  has_tty || { printf '%s' ""; return 0; }
  printf '%s' "$1" >/dev/tty
  IFS= read -r answer </dev/tty || answer=""
  printf '%s' "$answer"
}

# --- the domain ---------------------------------------------------------
# Required. Without one there is nothing for Caddy to get a certificate for,
# and the alternatives (a self-signed certificate, or plain HTTP) both put the
# Owner password on a connection nobody can verify. Resolved first, before the
# script asks for root or touches the machine, so a typo costs nothing.
domain="${SUPAFFI_DOMAIN:-}"
if [ -z "$domain" ]; then
  domain="$(ask 'Domain for this Supaffi instance (e.g. supaffi.example.com): ')"
fi
domain="$(printf '%s' "$domain" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

if [ -z "$domain" ]; then
  {
    echo "A domain is required."
    echo
    echo "Point one at this server's public IP, then run:"
    echo
    echo "  curl -fsSL https://get.supaffi.com | sudo SUPAFFI_DOMAIN=supaffi.example.com bash"
  } >&2
  exit 1
fi

case "$domain" in
  *://*|*/*) die "Use a bare hostname, with no scheme and no path. Got: $domain" ;;
  *.*) ;;
  *) die "That does not look like a domain: $domain" ;;
esac

# --- how it gets served -------------------------------------------------
# Bundled Caddy takes ports 80 and 443 for itself. A server that already runs
# a reverse proxy has neither to give, and that is the common case for anyone
# self-hosting more than one thing, so the answer is asked for rather than
# assumed.
port_busy() {
  if command -v ss >/dev/null 2>&1; then
    ss -ltnH "sport = :$1" 2>/dev/null | grep -q .
  elif command -v lsof >/dev/null 2>&1; then
    lsof -nP -iTCP:"$1" -sTCP:LISTEN >/dev/null 2>&1
  else
    # Neither tool present, so we cannot tell. Do not guess; let the question
    # decide.
    return 1
  fi
}

mode="${SUPAFFI_PROXY_MODE:-}"
if [ -z "$mode" ]; then
  if port_busy 80 || port_busy 443; then
    say "Port 80 or 443 is already in use, so Supaffi will not bring its own proxy."
    mode="external"
  else
    case "$(ask 'Let Supaffi handle HTTPS on ports 80 and 443? [Y/n] ')" in
      [Nn]*) mode="external" ;;
      *) mode="bundled" ;;
    esac
  fi
fi
case "$mode" in
  bundled|external) ;;
  *) die "SUPAFFI_PROXY_MODE must be 'bundled' or 'external'. Got: $mode" ;;
esac

# --- privileges and tools -----------------------------------------------
[ "$(id -u)" -eq 0 ] \
  || die "Run this as root: curl -fsSL https://get.supaffi.com | sudo bash"

command -v git >/dev/null 2>&1 || die "Missing git. Install it, then run this again."
command -v openssl >/dev/null 2>&1 || die "Missing openssl. Install it, then run this again."

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    local major
    major="$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1)"
    [ -n "$major" ] \
      || die "Docker is installed but its daemon is not responding. Start it, then run this again."
    [ "$major" -ge "$MIN_DOCKER_MAJOR" ] \
      || die "Docker $major is too old. Supaffi needs $MIN_DOCKER_MAJOR or newer."
  else
    say "Docker is not installed."
    local answer=""
    if [ "${SUPAFFI_INSTALL_DOCKER:-}" = "yes" ]; then
      answer="y"
    elif has_tty; then
      answer="$(ask 'Install it now with the official Docker script? [Y/n] ')"
      [ -n "$answer" ] || answer="y"
    else
      die "Docker is missing and there is no terminal to ask on. Install Docker first, or re-run with SUPAFFI_INSTALL_DOCKER=yes."
    fi
    case "$answer" in
      [Nn]*) die "Install Docker, then run this again: https://docs.docker.com/engine/install/" ;;
    esac
    # Docker's own convenience script, the same one Coolify's installer
    # reaches for first. Their docs call it unsupported for production, and
    # reimplementing per-distro installation across fifteen distributions is
    # not something this project can carry, so a failure points at their
    # instructions rather than guessing at a package manager.
    curl -fsSL https://get.docker.com | sh \
      || die "Docker install failed. Follow https://docs.docker.com/engine/install/ then run this again."
  fi

  docker compose version >/dev/null 2>&1 \
    || die "Docker Compose v2 is missing. See https://docs.docker.com/compose/install/"
}
ensure_docker

# --- the stack ----------------------------------------------------------
if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  git -C "$DIR" fetch --depth 1 origin main
  git -C "$DIR" reset --hard FETCH_HEAD
else
  say "Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
fi
cd "$DIR"

# --- configuration ------------------------------------------------------
touch .env
chmod 600 .env

# Per-key, so an existing install upgrading into a version that added a new
# secret gets that one appended without regenerating (and thereby
# invalidating) the ones it already has.
grep -q '^MASTER_ENCRYPTION_KEY=' .env || echo "MASTER_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
grep -q '^POSTGRES_PASSWORD=' .env || echo "POSTGRES_PASSWORD=$(openssl rand -hex 24)" >> .env
grep -q '^AUTH_SECRET=' .env || echo "AUTH_SECRET=$(openssl rand -base64 32)" >> .env

# Rewritten rather than preserved, since the operator just told us what these
# should be. Filtered through a temporary file rather than `sed -i`, whose
# in-place flag takes an argument on BSD and not on GNU. The temp file is
# chmod'd before the mv, not after: .env holds live secrets by this point, and
# a redirect creates .env.tmp under the process umask (typically world
# readable), so moving it into place before restricting its mode would leave
# .env briefly readable by anyone, permanently if the script died in between.
set_env_key() {
  if grep -q "^$1=" .env; then
    grep -v "^$1=" .env > .env.tmp && chmod 600 .env.tmp && mv .env.tmp .env
  fi
  printf '%s=%s\n' "$1" "$2" >> .env
  chmod 600 .env
}

set_env_key SUPAFFI_DOMAIN "$domain"
set_env_key SUPAFFI_APP_BIND "${SUPAFFI_APP_BIND:-127.0.0.1:3000}"
if [ "$mode" = "bundled" ]; then
  set_env_key COMPOSE_PROFILES "bundled-proxy"
else
  set_env_key COMPOSE_PROFILES ""
fi

# --- up -----------------------------------------------------------------
docker compose up -d --build

# --- the setup token ----------------------------------------------------
# Printed by the app's startup hook when no Owner exists yet. Contract with
# src/instrumentation.ts: one line, "setup token: <token>".
say "Waiting for Supaffi to start."
token=""
for _ in $(seq 1 60); do
  token="$(docker compose logs app 2>/dev/null \
    | sed -n 's/.*setup token: \([A-Za-z0-9_-]\{16,\}\).*/\1/p' \
    | tail -n 1)"
  [ -n "$token" ] && break
  sleep 5
done

echo
echo "────────────────────────────────────────────────────────────────────────"
if [ -n "$token" ]; then
  echo "  Open https://$domain/setup and paste this token:"
  echo
  echo "      $token"
else
  echo "  Supaffi is starting but has not printed a setup token yet."
  echo "  Either it is still building, or this instance already has an Owner."
  echo
  echo "  Check with:  cd $DIR && docker compose logs app"
fi
echo
if [ "$mode" = "bundled" ]; then
  echo "  If $domain does not point at this server's public IP yet, set that"
  echo "  DNS record now. Caddy keeps retrying until it resolves."
else
  echo "  Supaffi is not handling HTTPS. Point your own reverse proxy at:"
  echo
  echo "      http://127.0.0.1:3000"
  echo
  echo "  Serve it on $domain, and give every product subdomain you add later"
  echo "  the same treatment."
fi
echo "────────────────────────────────────────────────────────────────────────"
