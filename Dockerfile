FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
# npm ci runs the postinstall hook (`prisma generate`), which needs the
# schema present, so it has to be copied in before npm ci runs, not just
# in the builder stage's later `COPY . .`.
COPY prisma ./prisma
RUN npm ci

FROM node:24-alpine AS builder
WORKDIR /app
# Auth.js v5 needs AUTH_SECRET present when its config module loads, which
# happens during `next build` while compiling the /api/auth routes, not
# just at runtime. Passed in as a build arg (docker-compose.yml), doesn't
# need to be the real deployed secret, just present so the build succeeds —
# the actual runtime value comes from the container's own AUTH_SECRET env var.
ARG AUTH_SECRET=build-time-placeholder-not-used-at-runtime
ENV AUTH_SECRET=${AUTH_SECRET}
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npx prisma generate
RUN npm run build

# The Prisma CLI on its own, for the entrypoint's `migrate deploy`. Installed
# against the project's lockfile, so every package in its tree is the version
# CI tested, but with nothing else in package.json: the build tools, the test
# runner and the rest of the dev dependencies never reach the runtime image.
# Scripts stay on because @prisma/engines downloads the migration engine for
# this platform in its postinstall.
FROM node:24-alpine AS migrator
WORKDIR /migrator
COPY package-lock.json ./
RUN node -e 'const v = require("./package-lock.json").packages["node_modules/prisma"].version; require("fs").writeFileSync("package.json", JSON.stringify({ private: true, dependencies: { prisma: v } }))' \
  && npm install --no-audit --no-fund

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

# Baked in at build time by the release workflow, which takes it from the git
# tag. Defaults to "dev" so a locally built image is never mistaken for a
# release, and so the update check has something honest to compare against.
ARG SUPAFFI_VERSION=dev
ENV SUPAFFI_VERSION=${SUPAFFI_VERSION}

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# Only what the server traced plus the migration CLI, kept apart under /opt
# so the two dependency trees cannot overwrite each other.
COPY --from=migrator /migrator/node_modules /opt/prisma/node_modules
# Nothing runs npm in here, and every package it bundles is one more set of
# advisories to answer for.
RUN rm -rf /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
  /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
