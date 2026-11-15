-- Proof that an Owner controls their product's domain, and a hold on domains
-- given up. Every domain that exists today keeps working: it counts as proven.
ALTER TABLE "Merchant" ADD COLUMN     "domainToken" TEXT,
ADD COLUMN     "domainVerifiedAt" TIMESTAMP(3);

CREATE TABLE "ReleasedDomain" (
    "domain" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleasedDomain_pkey" PRIMARY KEY ("domain")
);

UPDATE "Merchant" SET "domainVerifiedAt" = CURRENT_TIMESTAMP WHERE "domainVerifiedAt" IS NULL;
