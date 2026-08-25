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

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/prisma ./prisma
# The entrypoint runs `prisma migrate deploy` at container start, which
# needs the Prisma CLI's full dependency tree, not just its own package —
# copying select node_modules subdirectories by hand (tried first) breaks
# on transitive dependencies (e.g. @prisma/config needing the `effect`
# package) that aren't obvious until the CLI actually runs. The Next.js
# standalone output already excludes unused deps from its own bundle, so
# this is the CLI's cost alone, not a general bloat of the image.
COPY --from=builder /app/node_modules ./node_modules
COPY docker/entrypoint.sh ./entrypoint.sh
RUN chmod +x ./entrypoint.sh

EXPOSE 3000
ENTRYPOINT ["./entrypoint.sh"]
