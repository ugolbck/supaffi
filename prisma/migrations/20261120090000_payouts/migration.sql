-- A payout becomes a row of its own, so it can carry how it was sent and a
-- reference. Until now a payout was the set of paid commissions sharing one
-- affiliate, currency and paidAt; each of those sets becomes one Payout here,
-- at what its commissions add up to.
ALTER TABLE "Commission" ADD COLUMN     "payoutId" TEXT;

ALTER TABLE "Program" ADD COLUMN     "minimumPayout" DECIMAL(18,2);

CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT,
    "reference" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

INSERT INTO "Payout" ("id", "merchantId", "affiliateId", "currency", "amount", "paidAt", "createdAt")
SELECT gen_random_uuid()::text, c."merchantId", c."affiliateId", c."currency", SUM(c."amount"), c."paidAt", c."paidAt"
FROM "Commission" c
WHERE c."status" = 'PAID' AND c."paidAt" IS NOT NULL
GROUP BY c."merchantId", c."affiliateId", c."currency", c."paidAt";

UPDATE "Commission" c
SET "payoutId" = p."id"
FROM "Payout" p
WHERE c."status" = 'PAID'
  AND c."merchantId" = p."merchantId"
  AND c."affiliateId" = p."affiliateId"
  AND c."currency" = p."currency"
  AND c."paidAt" = p."paidAt";

CREATE INDEX "Payout_merchantId_paidAt_idx" ON "Payout"("merchantId", "paidAt");

CREATE INDEX "Payout_affiliateId_paidAt_idx" ON "Payout"("affiliateId", "paidAt");

CREATE INDEX "Commission_payoutId_idx" ON "Commission"("payoutId");

ALTER TABLE "Commission" ADD CONSTRAINT "Commission_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Payout" ADD CONSTRAINT "Payout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
