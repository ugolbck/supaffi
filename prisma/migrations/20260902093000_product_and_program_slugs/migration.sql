-- URL slugs for Merchant (shown as "product") and Program.
--
-- Added nullable, backfilled from the existing names, then made NOT NULL, so
-- an instance with rows already in it migrates without a manual step.

ALTER TABLE "Merchant" ADD COLUMN "slug" TEXT;
ALTER TABLE "Program" ADD COLUMN "slug" TEXT;

-- Mirrors src/lib/slug.ts: lowercase, every run of non-alphanumerics becomes a
-- single hyphen, trimmed at both ends, capped at 48 characters. Rows whose
-- name has no alphanumerics at all fall back to a fixed base, and duplicates
-- within the same parent get a numeric suffix, matching uniqueSlug().
WITH base AS (
  SELECT
    id,
    "ownerId",
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 48)),
        ''
      ),
      'product'
    ) AS slug_base
  FROM "Merchant"
),
numbered AS (
  SELECT
    id,
    slug_base,
    row_number() OVER (PARTITION BY "ownerId", slug_base ORDER BY id) AS rn
  FROM base
)
UPDATE "Merchant" m
SET "slug" = CASE WHEN n.rn = 1 THEN n.slug_base ELSE n.slug_base || '-' || n.rn END
FROM numbered n
WHERE n.id = m.id;

WITH base AS (
  SELECT
    id,
    "merchantId",
    COALESCE(
      NULLIF(
        trim(BOTH '-' FROM left(regexp_replace(lower(name), '[^a-z0-9]+', '-', 'g'), 48)),
        ''
      ),
      'program'
    ) AS slug_base
  FROM "Program"
),
numbered AS (
  SELECT
    id,
    slug_base,
    row_number() OVER (PARTITION BY "merchantId", slug_base ORDER BY id) AS rn
  FROM base
)
UPDATE "Program" p
SET "slug" = CASE WHEN n.rn = 1 THEN n.slug_base ELSE n.slug_base || '-' || n.rn END
FROM numbered n
WHERE n.id = p.id;

ALTER TABLE "Merchant" ALTER COLUMN "slug" SET NOT NULL;
ALTER TABLE "Program" ALTER COLUMN "slug" SET NOT NULL;

CREATE UNIQUE INDEX "Merchant_ownerId_slug_key" ON "Merchant"("ownerId", "slug");
CREATE UNIQUE INDEX "Program_merchantId_slug_key" ON "Program"("merchantId", "slug");
