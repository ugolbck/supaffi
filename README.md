# Supaffi

Simple, self-hostable affiliate program software for SaaS founders. Stripe-native, one-command install.

## Self-hosting

```sh
curl -fsSL https://get.supaffi.com | bash
```

Point a domain's DNS at your server, then visit it to finish setup. See [docker-compose.yml](./docker-compose.yml) and [Caddyfile](./Caddyfile) for the full stack.

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
