#!/usr/bin/env bash
set -euo pipefail

# One-command self-hosted install. Asks nothing.
#   curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/main/install.sh | sudo bash
#
# get.supaffi.com does not exist yet, so the raw URL above is the real one.
# Swap it back when the install service is built.
#
# Nothing below is prompted for in a normal run. Every knob is an environment
# variable for the operator who wants one, and every variable goes on `bash`,
# not on `curl`: putting it before curl sets it for the download rather than
# for this script.
#
#   SUPAFFI_HOST_IP          address the dashboard is served on, detected
#   SUPAFFI_DASHBOARD_PORT   where it listens, default 3443
#   SUPAFFI_PROXY_MODE       bundled or external, decided on first install
#   SUPAFFI_DOMAIN           optional domain for the instance itself
#   SUPAFFI_APP_BIND         where the app's port lands on the host
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

# --- reusing an existing install's configuration ------------------------
# An upgrade re-runs this script against a $DIR that may already hold .env
# from a previous install. Read it here, before the root check, so an
# upgrade run unattended (cron, a provisioning script) does not re-prompt for
# things it already knows. Read tolerantly: .env is mode 600 and typically
# root-owned, and this runs before the privilege check on purpose (validating
# input before asking for root is deliberate, so a typo costs nothing), so as
# a non-root operator the read below usually just fails and falls through to
# the current behaviour. Extracted with grep and cut, not sourced: .env holds
# secrets and arbitrary values that have no business being evaluated as
# shell.
#
# existing_env_value reads a missing key as an empty value and never reports
# failure. It is deliberately sed and not grep: under `set -euo pipefail` a
# grep that matches nothing fails the whole pipeline, so a bare assignment
# like `domain="$(existing_env_value SUPAFFI_DOMAIN)"` would kill the script
# outright the moment the key is absent, printing nothing. Every install made
# before this feature existed has secrets in .env and no SUPAFFI_DOMAIN, so
# that is the common upgrade, not an edge case. sed exits 0 whether or not it
# matched, which makes the safety a property of the command rather than of a
# trailing `|| true` that the next edit can drop.
existing_env_value() {
  [ -r "$DIR/.env" ] || return 0
  sed -n "s/^$1=//p" "$DIR/.env" 2>/dev/null | tail -n 1
}
# A predicate, so a missing key is a false result rather than an error. This
# one is meant to be called as an `if` condition (which `set -e` exempts) and
# nowhere else; it is what keeps a stored-but-empty value distinguishable from
# an absent key, which existing_env_value alone cannot tell apart.
existing_env_has_key() {
  [ -r "$DIR/.env" ] || return 1
  grep -q "^$1=" "$DIR/.env" 2>/dev/null
}

# --- the domain ---------------------------------------------------------
# Never asked for. The dashboard is served on this server's own address with a
# certificate Caddy signs itself, so an install needs no DNS record and no
# decision from someone who has not used the product yet. Every question in an
# installer is a chance to lose a person who has not decided anything yet.
#
# Still honoured when set deliberately, and still remembered across upgrades,
# because that path already works. Each affiliate program needs its own
# hostname regardless, and that is added inside the product, not here.
domain="${SUPAFFI_DOMAIN:-}"
if [ -z "$domain" ]; then
  domain="$(existing_env_value SUPAFFI_DOMAIN)"
fi
domain="$(printf '%s' "$domain" | tr -d '[:space:]' | tr '[:upper:]' '[:lower:]')"

if [ -n "$domain" ]; then
  case "$domain" in
    *://*|*/*) die "SUPAFFI_DOMAIN must be a bare hostname, with no scheme and no path. Got: $domain" ;;
    *,*) die "SUPAFFI_DOMAIN takes one domain. Got: $domain" ;;
    *\**) die "A wildcard gets no certificate. SUPAFFI_DOMAIN needs one hostname Caddy can serve. Got: $domain" ;;
    *:*) die "SUPAFFI_DOMAIN must be a bare hostname, with no port. Got: $domain" ;;
    *.*) ;;
    *) die "SUPAFFI_DOMAIN does not look like a domain: $domain" ;;
  esac
fi

# --- this server's address ----------------------------------------------
# The name the dashboard certificate is issued for, and the address the
# operator types into their browser. Asked of an outside service first,
# because the address they reach us on is the public one and on most hosts
# that is not what the machine's own interfaces report. The local lookup
# covers a box with no outbound access. Every step tolerates failure, and the
# prompt at the end is a last resort rather than a question in the normal
# flow.
host_ip="${SUPAFFI_HOST_IP:-}"
if [ -z "$host_ip" ]; then
  host_ip="$(existing_env_value SUPAFFI_HOST_IP)"
fi
if [ -z "$host_ip" ]; then
  host_ip="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || true)"
fi
if [ -z "$host_ip" ] && command -v hostname >/dev/null 2>&1; then
  host_ip="$(hostname -I 2>/dev/null | awk '{print $1}' || true)"
fi
host_ip="$(printf '%s' "$host_ip" | tr -d '[:space:]')"
if [ -z "$host_ip" ]; then
  host_ip="$(ask 'Could not detect this server address. Enter its public IP: ')"
  host_ip="$(printf '%s' "$host_ip" | tr -d '[:space:]')"
fi

case "$host_ip" in
  "") die "No address to serve the dashboard on. Re-run with SUPAFFI_HOST_IP set to this server's public IP." ;;
  *://*|*/*) die "SUPAFFI_HOST_IP must be a bare address, with no scheme and no path. Got: $host_ip" ;;
  *,*|*\ *) die "SUPAFFI_HOST_IP takes one address. Got: $host_ip" ;;
  # A bare IPv6 address has to be bracketed inside a Caddy site address, which
  # this script does not build, so refuse clearly instead of writing a config
  # that fails to parse hours later. A hostname is accepted and works.
  *:*) die "SUPAFFI_HOST_IP does not support IPv6 yet. Set it to an IPv4 address or a hostname that resolves to this server. Got: $host_ip" ;;
esac

# Where that dashboard listens. Same precedence as everything else: an
# explicit variable, then the existing install, then the default.
dashboard_port="${SUPAFFI_DASHBOARD_PORT:-}"
if [ -z "$dashboard_port" ]; then
  dashboard_port="$(existing_env_value SUPAFFI_DASHBOARD_PORT)"
fi
if [ -z "$dashboard_port" ]; then
  dashboard_port=3443
fi
case "$dashboard_port" in
  ""|*[!0-9]*) die "SUPAFFI_DASHBOARD_PORT must be a port number. Got: $dashboard_port" ;;
esac
if [ "$dashboard_port" -lt 1024 ] || [ "$dashboard_port" -gt 65535 ]; then
  die "SUPAFFI_DASHBOARD_PORT must be between 1024 and 65535. Got: $dashboard_port"
fi

# --- how it gets served -------------------------------------------------
# Bundled Caddy takes ports 80 and 443 for itself. A server that already runs
# a reverse proxy has neither to give, and that is the common case for anyone
# self-hosting more than one thing, so this is worked out rather than asked.
# The dashboard is unaffected either way, because it has its own port.
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

# Decided, not asked, and only once. Precedence: an explicit
# SUPAFFI_PROXY_MODE wins outright, then whatever the existing install stored,
# then a look at the ports.
#
# The stored value beating a fresh look is the whole point. After a bundled
# install it is Supaffi's own Caddy holding 80 and 443, so re-detecting would
# find them busy, conclude that somebody else owns them, and shut Supaffi's
# proxy down during what the operator thought was a routine update. Every
# affiliate program would go dark and nothing would say why. Changing this is
# an explicit act: SUPAFFI_PROXY_MODE.
#
# There is no separate stored key; COMPOSE_PROFILES is what set_env_key
# already writes. Matched as a substring, because that value also carries
# dashboard-tls, and an exact comparison against bundled-proxy would read
# every bundled install as external, which is the same outage by another
# route.
mode="${SUPAFFI_PROXY_MODE:-}"
if [ -z "$mode" ] && existing_env_has_key COMPOSE_PROFILES; then
  case "$(existing_env_value COMPOSE_PROFILES)" in
    *bundled-proxy*) mode="bundled" ;;
    *) mode="external" ;;
  esac
fi
if [ -z "$mode" ]; then
  if port_busy 80 || port_busy 443; then
    say "Port 80 or 443 is already in use, so Supaffi will not bring its own proxy."
    mode="external"
  else
    mode="bundled"
  fi
fi
case "$mode" in
  bundled|external) ;;
  *) die "SUPAFFI_PROXY_MODE must be 'bundled' or 'external'. Got: $mode" ;;
esac

# --- privileges and tools -----------------------------------------------
[ "$(id -u)" -eq 0 ] \
  || die "Run this as root: curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/main/install.sh | sudo bash"

command -v git >/dev/null 2>&1 || die "Missing git. Install it, then run this again."
command -v openssl >/dev/null 2>&1 || die "Missing openssl. Install it, then run this again."

ensure_docker() {
  if command -v docker >/dev/null 2>&1; then
    local major
    # `|| true` inside the substitution, not after it. A daemon that is
    # installed but not answering fails this pipeline, and under `set -e` a
    # bare assignment from a failed substitution kills the script outright,
    # before the message below gets to explain what happened.
    major="$(docker version --format '{{.Server.Version}}' 2>/dev/null | cut -d. -f1 || true)"
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
# An upgrade replaces the checkout wholesale, so anything the operator changed
# by hand in a tracked file is about to be destroyed without being mentioned.
# Refuse instead, and name the escape hatch. Untracked files are not at risk
# (a hard reset leaves them alone) and .env is ignored, so neither shows here.
refuse_local_edits() {
  if [ "${SUPAFFI_DISCARD_LOCAL_CHANGES:-}" = "yes" ]; then
    say "Discarding local changes, as asked."
    return 0
  fi
  if git diff --quiet && git diff --cached --quiet; then
    return 0
  fi
  {
    echo "This install has local changes to files the update would overwrite:"
    echo
    git diff --name-only
    git diff --cached --name-only
    echo
    echo "Keep them somewhere safe, then run this again. To discard them:"
    echo
    echo "  SUPAFFI_DISCARD_LOCAL_CHANGES=yes"
  } >&2
  exit 1
}

# Taken before the update touches anything, so a schema change that goes wrong
# is a restore rather than a loss. Written next to the install because that is
# the one place the operator is certain to look; it is not a substitute for
# the off-server backups the README asks for, and it says so.
#
# A failure here stops the update. The whole point is to not proceed without
# it, and an operator who disagrees has SUPAFFI_SKIP_BACKUP.
backup_database() {
  if [ "${SUPAFFI_SKIP_BACKUP:-}" = "yes" ]; then
    say "Skipping the pre-update backup, as asked."
    return 0
  fi
  # Nothing to dump before the first run brings the database up.
  if ! docker compose ps -a -q db 2>/dev/null | grep -q .; then
    return 0
  fi
  # A database that exists but is not running cannot be dumped, and refusing
  # here would block the operator whose stack is already broken and who is
  # updating to fix it. Say it plainly and carry on, rather than skipping in
  # silence and letting them believe a backup was taken.
  if ! docker compose ps -q db 2>/dev/null | grep -q .; then
    say "The database is not running, so no backup was taken. Continuing."
    return 0
  fi

  mkdir -p backups
  chmod 700 backups
  local file
  file="backups/supaffi-$(date -u +%Y%m%d-%H%M%S).sql.gz"

  say "Backing up the database to $DIR/$file"
  if docker compose exec -T db pg_dump -U supaffi supaffi | gzip > "$file"; then
    chmod 600 "$file"
    say "Backed up. Older dumps are kept; prune $DIR/backups yourself."
  else
    rm -f "$file"
    {
      echo "The database backup failed, so nothing was changed and your"
      echo "install is still running the version it was."
      echo
      echo "Check it is healthy:  cd $DIR && docker compose logs db"
      echo "To update anyway:     SUPAFFI_SKIP_BACKUP=yes"
    } >&2
    exit 1
  fi
}

if [ -d "$DIR/.git" ]; then
  say "Updating $DIR"
  cd "$DIR"
  refuse_local_edits
  backup_database
  git fetch --depth 1 origin main
  git reset --hard FETCH_HEAD
else
  say "Cloning into $DIR"
  git clone --depth 1 "$REPO" "$DIR"
  cd "$DIR"
fi

# --- ports that are not ours --------------------------------------------
# Runs here and not with the mode decision above, because telling our own
# container apart from a stranger's needs a checkout to ask Docker about.
#
# Whether $1 is held by a process that is not one of our own containers.
# Answering "is this port busy" is not enough: after a bundled install our own
# Caddy is the one holding 80 and 443, and treating that as a conflict would
# block every update.
foreign_listener() {
  port_busy "$1" || return 1
  local ours
  ours="$(docker compose ps -q "$2" 2>/dev/null || true)"
  [ -z "$ours" ]
}

# An operator who installs nginx after Supaffi finds that nginx will not
# start, because Supaffi's Caddy already holds the ports. That is the loud,
# immediate failure and it is the right one. What must not happen is Supaffi
# quietly standing aside at the next update. So: say what is wrong, name the
# one way out, and change nothing.
if [ "$mode" = "bundled" ] && { foreign_listener 80 caddy || foreign_listener 443 caddy; }; then
  {
    echo "Supaffi is set to serve HTTPS on ports 80 and 443, but something else"
    echo "on this server is holding them and it is not Supaffi."
    echo
    echo "Nothing was changed. Stop the other service, or hand the ports to it:"
    echo
    echo "  cd $DIR && SUPAFFI_PROXY_MODE=external bash install.sh"
  } >&2
  exit 1
fi

# Same reasoning for the dashboard. Without this the install dies inside
# `docker compose up` with a port allocation error that names no fix.
if foreign_listener "$dashboard_port" caddy-dashboard; then
  {
    echo "Port $dashboard_port is already in use by something else, and that is"
    echo "where the Supaffi dashboard is served."
    echo
    echo "Nothing was changed. Pick another port and run this again:"
    echo
    echo "  cd $DIR && SUPAFFI_DASHBOARD_PORT=8443 bash install.sh"
  } >&2
  exit 1
fi

# --- configuration ------------------------------------------------------
# Every write below this line touches a file holding the master encryption
# key, the database password and the auth secret. A restrictive umask means
# nothing created here can be born readable by anyone else, including the
# temporary file set_env_key writes before its own chmod lands. The explicit
# chmods stay: two independent guarantees on this file rather than one.
old_umask="$(umask)"
umask 077

touch .env
chmod 600 .env

# Whether this install has run before, read before the keys below get
# appended. Used only to decide how long to wait for a setup token.
upgrade=no
if grep -q '^MASTER_ENCRYPTION_KEY=' .env; then
  upgrade=yes
fi

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

# Same precedence as the domain and the proxy mode: an explicit variable
# wins, then whatever the existing install stored, then the default. Written
# unconditionally, this would revert on every upgrade, and an operator whose
# proxy is itself a container has to change it for that proxy to reach the
# app at all.
bind="${SUPAFFI_APP_BIND:-}"
if [ -z "$bind" ]; then
  bind="$(existing_env_value SUPAFFI_APP_BIND)"
fi
if [ -z "$bind" ]; then
  bind="127.0.0.1:3000"
fi

set_env_key SUPAFFI_DOMAIN "$domain"
set_env_key SUPAFFI_HOST_IP "$host_ip"
set_env_key SUPAFFI_DASHBOARD_PORT "$dashboard_port"
set_env_key SUPAFFI_APP_BIND "$bind"
# dashboard-tls is unconditional: the dashboard has to be reachable on a
# server whose 80 and 443 belong to somebody else, which is exactly where the
# bundled proxy does not run.
if [ "$mode" = "bundled" ]; then
  set_env_key COMPOSE_PROFILES "dashboard-tls,bundled-proxy"
else
  set_env_key COMPOSE_PROFILES "dashboard-tls"
fi

umask "$old_umask"

# --- up -----------------------------------------------------------------
# Dropping caddy from COMPOSE_PROFILES does not stop a container from an
# earlier bundled install: Compose only removes containers for services that
# have vanished from the compose file entirely, and a profile-excluded
# service is still a defined service, not an orphan. `--remove-orphans` does
# not touch it either, for the same reason; reach for it here and the old
# container keeps holding ports 80 and 443. Stopping it by name is the only
# thing that works, and it is a no-op (exit 0) on a fresh install where the
# container was never created, so this is safe under set -e either way.
if [ "$mode" = "external" ]; then
  docker compose stop caddy
  docker compose rm -f caddy
fi
docker compose up -d --build

# --- the setup token ----------------------------------------------------
# Printed by the app's startup hook when no Owner exists yet. Contract with
# src/instrumentation.ts: one line, "setup token: <token>".
#
# An instance that already has an Owner never prints one again, so on an
# upgrade this is usually a wait for something that is not coming. $upgrade is
# the honest signal available here: .env already held the secrets an earlier
# run generated. It cannot tell whether that run ever created an Owner, so the
# poll is shortened rather than skipped.
say "Waiting for Supaffi to start."
if [ "$upgrade" = "yes" ]; then
  attempts=4
else
  attempts=12
fi
token=""
for _ in $(seq 1 "$attempts"); do
  # `|| true` inside the substitution, for the same reason as the docker
  # version check above: a compose command returning non-zero would otherwise
  # abort the script here, right after the stack came up, printing neither a
  # token nor a reason.
  token="$(docker compose logs app 2>/dev/null \
    | sed -n 's/.*setup token: \([A-Za-z0-9_-]\{16,\}\).*/\1/p' \
    | tail -n 1 || true)"
  [ -n "$token" ] && break
  sleep 5
done

# The address that always works, whatever else is configured. A domain, when
# somebody set one deliberately, is a nicety on top rather than the thing to
# print here.
setup_url="https://$host_ip:$dashboard_port"

echo
echo "────────────────────────────────────────────────────────────────────────"
if [ -n "$token" ]; then
  echo "  Open $setup_url/setup and paste this token:"
  echo
  echo "      $token"
elif [ "$upgrade" = "yes" ]; then
  echo "  No setup token: an instance that already has an Owner does not issue one."
  echo
  echo "  Open $setup_url"
  echo
  echo "  If this one never finished setup:  cd $DIR && docker compose logs app"
else
  echo "  Supaffi is starting but has not printed a setup token yet."
  echo
  echo "  Check with:  cd $DIR && docker compose logs app"
fi
echo
echo "  Your browser will warn about the certificate. Continue past it. The"
echo "  warning means it cannot verify who this server is, which you already"
echo "  know. The connection is encrypted."
echo
echo "  If that address does not load, your hosting provider is blocking port"
echo "  $dashboard_port. Allow it in their firewall, not on the server."
echo "────────────────────────────────────────────────────────────────────────"
