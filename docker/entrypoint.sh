#!/bin/sh
set -e

# Runs on every container start. Applies any pending migrations before the
# server starts, so updating is just `docker compose pull && up`, nothing
# manual. A failed migration blocks the server from starting rather than
# running against a schema it doesn't match.
npx prisma migrate deploy

exec node server.js
