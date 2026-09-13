-- Codes an Affiliate renamed or deleted, so they can never be claimed by a
-- different Affiliate while old links carrying them are still out there.
-- Nothing to backfill: codes retired before this existed were not recorded.

CREATE TABLE "RetiredLinkCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "retiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RetiredLinkCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RetiredLinkCode_code_key" ON "RetiredLinkCode"("code");
CREATE INDEX "RetiredLinkCode_affiliateId_idx" ON "RetiredLinkCode"("affiliateId");
