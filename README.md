# Supaffi

Simple, self-hostable affiliate program software for SaaS founders. Stripe-native, one-command install.

## Self-hosting

You need a server. Nothing else. Docker gets installed if it is missing.

```sh
curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/main/install.sh | sudo bash
```

It asks nothing and prints an address and a token:

```
Open https://203.0.113.45:3443/setup and paste this token:

    7Kq2xN...
```

Open it, continue past the browser warning, paste the token, and pick an email
and password. You are in.

The warning is expected. The certificate was signed by your own server rather
than by an authority your browser knows, so it cannot vouch for who you are
talking to, which at your own server's address you already know. The connection
is encrypted regardless. Portainer and Proxmox do the same thing.

If the address does not load at all, your hosting provider is blocking the
port. Allow it in their firewall, not on the server.

### Adding your first program

Each affiliate program needs one hostname on that product's own domain. This is
the only DNS you ever do.

1. Add an A record for `affiliates.yourproduct.com` pointing at your server.
2. Add the product in the dashboard: that hostname, your site's address, your
   Stripe keys.
3. Paste the tracking snippet into your site.

That hostname is where your affiliates sign up, where their dashboard lives, and
the domain their emails come from, so it has to be yours and it has to match the
product. A second program gets its own, on its own domain.

On Cloudflare, leave the proxy off (grey cloud) for that record.

### If you already run a reverse proxy

Nothing changes about the install. Supaffi leaves ports 80 and 443 alone when
something else already has them, and the dashboard keeps its own port either
way.

That choice is made once, on the first install, and remembered. If you later
want to hand the ports over, or take them back, say so:

```sh
cd /opt/supaffi && sudo SUPAFFI_PROXY_MODE=external bash install.sh
```

For each program hostname, add a block pointing at the app:

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

`Host` matters. Supaffi decides which product a visitor came for from the
hostname they arrived on, so a proxy that rewrites it serves the wrong one.

If your proxy is itself a container it cannot reach the host's loopback. Put
both on one network:

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

### A domain for the dashboard

Optional, and never asked for. Point one at your server and install with it
set:

```sh
curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/main/install.sh \
  | sudo SUPAFFI_DOMAIN=supaffi.example.com bash
```

The address above keeps working either way. Your affiliate programs do not use
this domain, so most people never need one.

### Updating

```sh
cd /opt/supaffi && curl -fsSL https://raw.githubusercontent.com/ugolbck/supaffi/main/install.sh | sudo bash
```

Your secrets and settings are kept. Migrations run on start. Supaffi tracks the
`main` branch today, so an update brings whatever has landed there. Versioned
releases are coming.

### Backups

Updating dumps the database to `/opt/supaffi/backups` first and stops if that
fails. That covers a bad update, not a dead disk, so you still want these two:

- **The database.** `docker compose exec -T db pg_dump -U supaffi supaffi | gzip > supaffi.sql.gz`, on a cron job, stored off the server.
- **`MASTER_ENCRYPTION_KEY` from `.env`.** It decrypts every product's Stripe
  and email credentials. Keep it somewhere other than next to the database
  backup, or one stolen backup gives up both.

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
  merchant: Instantgradient (localhost:3000)
  to:       sarah@example.com
  subject:  Log in to Instantgradient's affiliate program
  links:
    http://localhost:3000/affiliates/verify?token=...
────────────────────────────────────────────────────────────────────────
```

Paste the link into your browser to finish logging in. No Resend key needed.

Drop the line to send for real. Unset means send, so production needs no email config beyond the key each merchant connects in the UI.

Never set `console` in production. Those printed links are live single-use login tokens, so anyone who can read the logs can take over any affiliate account.

### Stripe webhooks

Stripe will not accept a `localhost` endpoint. Forward events with its CLI instead, and paste the `whsec_` it prints into the connect form:

```sh
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

## License

[AGPL-3.0](./LICENSE)
