# Supaffi

Simple, self-hostable affiliate program software for SaaS founders. Stripe-native, one-command install.

## Self-hosting

You need a server, and a domain you can point at it. Docker gets installed for
you if it is missing.

**1. Point a subdomain at your server's public IP.** An A record for something
like `supaffi.example.com`. This is where you will log in. Each product you run
a program for gets its own separate subdomain later.

On Cloudflare, leave the proxy off (grey cloud). Orange breaks certificate
issuance.

**2. Install.**

```sh
curl -fsSL https://get.supaffi.com | sudo bash
```

It asks two things: the domain from step 1, and whether Supaffi should handle
HTTPS itself. To answer both up front:

```sh
curl -fsSL https://get.supaffi.com | sudo SUPAFFI_DOMAIN=supaffi.example.com SUPAFFI_PROXY_MODE=bundled bash
```

The variables go on `bash`, not on `curl`.

**3. Open the URL it prints and paste the setup token.** The token is printed
once at startup and only works until you create the Owner account. Lost it?
`docker compose logs app`, or restart to issue a new one.

### If you already run a reverse proxy

Supaffi's built-in HTTPS wants ports 80 and 443. If something else already has
them, answer no to the second question, or pass
`SUPAFFI_PROXY_MODE=external`. Nothing binds 80 or 443, and Supaffi listens on
`127.0.0.1:3000` for your own proxy to forward to. The installer detects busy
ports and picks this mode by itself.

You then handle certificates, for your login domain and for every product
subdomain you add. Point them all at the same place:

```nginx
# nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`Host` matters. Supaffi decides which product a visitor is looking at from the
domain they arrived on, so a proxy that rewrites it will serve the wrong one.

**If your proxy is itself a container**, it cannot reach the host's loopback.
Put both on one network instead:

```yaml
# docker-compose.override.yml
services:
  app:
    networks: [default, proxy]
networks:
  proxy:
    external: true
    name: your-proxy-network
```

Your proxy then forwards to `http://supaffi-app-1:3000`.

### Updating

```sh
cd /opt/supaffi && curl -fsSL https://get.supaffi.com | sudo bash
```

Your secrets and settings are kept. Migrations run on start.

### Backups

Two things, and losing either one is unrecoverable:

- **The database.** `docker compose exec -T db pg_dump -U supaffi supaffi | gzip > supaffi.sql.gz`, on a cron job, stored off the server.
- **`MASTER_ENCRYPTION_KEY` from `.env`.** It decrypts every product's Stripe
  and email credentials. Store it somewhere other than next to the database
  backup, or a single stolen backup gives up both.

### Looking around before you have a domain

There is no way in without one, by design: the alternatives all mean either a
browser certificate warning or an unencrypted password on the screen where you
pick your Owner password.

To try it first, tunnel in. From your own machine:

```sh
ssh -L 3000:127.0.0.1:3000 you@your-server
```

Then open `http://localhost:3000/setup`. Supaffi already listens on that
address, in both modes.

## Stack

Next.js, Prisma, PostgreSQL. No Redis, no ClickHouse.

## Development

```sh
cp .env.example .env   # then fill in the two generated secrets
```

### Email

Affiliates log in by magic link, sent from `affiliates@<your-domain>`. Locally that domain is `localhost`, which no email provider will let you send from. `.env.example` ships with `EMAIL_DELIVERY=console`, which prints the email to your terminal instead:

```
────────────────────────────────────────────────────────────────────────
  EMAIL NOT SENT (EMAIL_DELIVERY=console)
  merchant: Instantgradient (localhost:3600)
  to:       sarah@example.com
  subject:  Log in to Instantgradient's affiliate program
  links:
    http://localhost:3600/affiliates/verify?token=...
────────────────────────────────────────────────────────────────────────
```

Paste the link into your browser to finish logging in. No Resend key needed.

Drop the line to send for real. Unset means send, so production needs no email config beyond the key each merchant connects in the UI.

Never set `console` in production. Those printed links are live single-use login tokens, so anyone who can read the logs can take over any affiliate account.

### Stripe webhooks

Stripe will not accept a `localhost` endpoint. Forward events with its CLI instead, and paste the `whsec_` it prints into the connect form:

```sh
stripe listen --forward-to localhost:3600/api/webhooks/stripe
```

## License

[AGPL-3.0](./LICENSE)
