---
name: changing-the-extension-seam
description: Use when touching src/extensions/, adding or changing a read of `ext.*` or `staticExt.*`, when behaviour must be replaceable by a downstream build, or when tempted to add an env flag or `if` that switches product behaviour by build.
---

# Changing the extension seam

## Overview

Supaffi is self-hosted first. Downstream builds change behaviour only through `src/extensions/`. Every hook has a default
that keeps self-hosted exactly as it is. This repo never contains or describes
downstream code.

## Files

| File | Role |
|---|---|
| `types.ts` | All hook types and `export const EXTENSIONS_API_VERSION = 1;` (keep on one line, builds read it by regex). |
| `static.ts` | `staticExt`: plain-data hooks and their defaults. Imports only types, `merge` and `installed-static`. |
| `defaults.ts` | This app's behaviour for every server hook. |
| `index.ts` | `ext`: server hooks. |
| `merge.ts` | Per-group merge; a key set to `undefined` keeps its default. |
| `installed.ts`, `installed-static.ts` | Empty here, replaced by downstream builds. Never put logic in them. |
| `core-api.ts` | Stable functions downstream code may call. |
| `test/extensions/` | `contract` (defaults), `wiring` (each hook reaches its page), `owners`, `core-api`. |

## Hook catalogue (API version 1)

Static (`staticExt`): `owners.signupPath`, `owners.passwordResetPath`, `instance.showInfo`.
Server (`ext`): `dashboard.gate`, `dashboard.banner`, `account.sections`.
Core API: `createOwnerAccount`, `findOwnerByEmail`, `setOwnerPassword`,
`listOwnerMerchants`, `currentOwnerId`, `signInOwner`, `isMerchantDomain`.
Read `types.ts` for signatures. Reuse a listed hook before adding one, and add
one only for a concrete need, not in anticipation.

## Rules

1. `src/lib/**`, `src/proxy.ts`, `src/instrumentation.ts` import only `@/extensions/static` and `@/extensions/types`. Server hooks (`ext`) are read in `src/app/**` pages, layouts and actions, and results passed down. Reason: a downstream `installed.ts` imports `core-api`, which imports `src/lib`; and anything the startup hook reaches is bundled for Edge, where Argon2 breaks the build. eslint and `test/instrumentation.test.ts` refuse it.
2. No build-specific env var, no `isBuildX()`, no `if` on build anywhere. A difference between builds is a hook.
3. Plain data that proxy or instrumentation needs is a static hook. Anything async or returning UI is a server hook.
4. Server hooks may return server-rendered `ReactNode`. Render it in a server component; hand it to a client component only as `children`. Otherwise return plain data.
5. A hook may hide something (return `null` or `false`) as long as its default never does.
6. A new hook ships with: type, default reproducing current behaviour, call site, a contract test for the default, a wiring test that installs a fake (`vi.resetModules()`, `vi.doMock("@/extensions/installed", ...)`, dynamic import) and asserts its effect.
7. Name and document hooks by where they plug in ("extra sections on the account page"). Never describe what a downstream build does with a hook, in code, comments, tests or docs.
8. Core API functions keep owner scoping and are tested against another Owner's data.
9. Renaming, removing, or changing a hook's signature or meaning bumps `EXTENSIONS_API_VERSION` and adds an "Extensions" line to `CHANGELOG.md`. Adding one does not bump.
10. Removing a hook's call site is breaking even if types compile. The wiring test must fail; never edit it to pass.

## Common mistakes

| Mistake | Fix |
|---|---|
| Default changes self-hosted output "slightly" | Default must be identical; existing tests pass unedited. |
| New hook invented when a catalogue hook fits | Use the catalogue hook. |
| `ext` imported in `src/lib/foo.ts` | Read it in the calling page or action, pass the value in. |
| Comment or test data hints at what a build does | Neutral wording and fixtures ("installed banner"). |
