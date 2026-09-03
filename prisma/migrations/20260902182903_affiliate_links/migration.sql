-- One AffiliateLink per Affiliate, carrying the code the Affiliate already has,
-- then Click.linkId pointed at it. Every existing click genuinely came through
-- that link: it was the only one that existed.

CREATE TABLE "AffiliateLink" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "destinationPath" TEXT,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AffiliateLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AffiliateLink_code_key" ON "AffiliateLink"("code");
CREATE INDEX "AffiliateLink_affiliateId_idx" ON "AffiliateLink"("affiliateId");

ALTER TABLE "AffiliateLink" ADD CONSTRAINT "AffiliateLink_affiliateId_fkey"
    FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- gen_random_uuid() rather than a cuid: this runs once, in SQL, and the id
-- only has to be unique and opaque.
INSERT INTO "AffiliateLink" ("id", "affiliateId", "code", "isPrimary", "createdAt")
SELECT gen_random_uuid()::text, "id", "referralCode", true, "createdAt"
FROM "Affiliate";

ALTER TABLE "Click" ADD COLUMN "linkId" TEXT;

UPDATE "Click" c
SET "linkId" = l."id"
FROM "AffiliateLink" l
WHERE l."affiliateId" = c."affiliateId" AND l."isPrimary" = true;

CREATE INDEX "Click_linkId_idx" ON "Click"("linkId");

ALTER TABLE "Click" ADD CONSTRAINT "Click_linkId_fkey"
    FOREIGN KEY ("linkId") REFERENCES "AffiliateLink"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Last, so the backfill above could read it.
ALTER TABLE "Affiliate" DROP COLUMN "referralCode";
