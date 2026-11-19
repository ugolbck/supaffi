# Contributing

Bug reports and feature requests go in [issues](https://github.com/ugolbck/supaffi/issues/new/choose). Security problems go to [private reporting](https://github.com/ugolbck/supaffi/security/advisories/new) instead.

## Before you write code

Small fixes can go straight to a pull request. For anything bigger, a new feature or a change to how commissions are calculated, open an issue first. It saves you building something that won't be merged.

## Running it locally

The [Development](README.md#development) section of the README gets you a running app and a test database.

## Checks

CI runs these on every pull request. Run them before you push:

```sh
npx tsc --noEmit
npm run lint
npm test
```

`npm test` needs the `supaffi_test` database from the README. It refuses any database whose name doesn't end in `_test`, because the tests delete data.

The browser tests in `e2e/` run the whole stack in Docker with fake Stripe and Polar servers. CI runs them for you. To run them yourself, follow `.github/workflows/e2e.yml`.

## What a good pull request has

- One change. Two unrelated fixes are two pull requests.
- A test that fails without your change and passes with it. Payment handling is the part that most needs one.
- A migration in `prisma/migrations/` if you changed `prisma/schema.prisma`. CI fails if the two don't match. Existing installs run it when they update, so think about rows that already exist.
- Text in the app that is short and plain. No em dashes.

Leave `CHANGELOG.md` and the version alone. They change when a release is cut.

## Extensions

Some behaviour can be replaced by a build that extends Supaffi, through `src/extensions/`. If your change touches that folder or reads `ext` or `staticExt`, read [`.claude/skills/changing-the-extension-seam/SKILL.md`](.claude/skills/changing-the-extension-seam/SKILL.md) first. It lists the rules the tests enforce.

## License

Supaffi is [AGPL-3.0](LICENSE). By opening a pull request you agree your contribution is released under it.
