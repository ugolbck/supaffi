#!/bin/sh
set -e

# Runs on every container start. Applies any pending migrations before the
# server starts, so updating is just `docker compose pull && up`, nothing
# manual. A failed migration blocks the server from starting rather than
# running against a schema it doesn't match.
#
# Invoked directly rather than via `npx prisma` / node_modules/.bin/prisma:
# Docker's COPY dereferences npm's .bin symlink into a flattened regular
# file, which breaks the CLI's __dirname-relative lookup of its own sibling
# files (e.g. prisma_schema_build_bg.wasm), since those only exist next to
# the real node_modules/prisma/build/index.js, not in .bin/.
node node_modules/prisma/build/index.js migrate deploy

exec node server.js
