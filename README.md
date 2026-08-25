# Supaffi

Simple, self-hostable affiliate program software for SaaS founders. Stripe-native, one-command install.

## Self-hosting

```sh
curl -fsSL https://get.supaffi.com | bash
```

Point a domain's DNS at your server, then visit it to finish setup. See [docker-compose.yml](./docker-compose.yml) and [Caddyfile](./Caddyfile) for the full stack.

## Stack

Next.js, Prisma, PostgreSQL. No Redis, no ClickHouse.

## License

[AGPL-3.0](./LICENSE)
