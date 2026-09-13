-- A referral that the Owner confirmed as a self referral stops earning.
ALTER TABLE "Click" ADD COLUMN "fraudConfirmedAt" TIMESTAMP(3);

-- When the one-time Stripe check of a click linked before 0.2.5 finished.
ALTER TABLE "Click" ADD COLUMN "legacyCheckedAt" TIMESTAMP(3);

-- Renewals are matched on the subscription a referred checkout created, per
-- product, instead of on the customer across the whole instance.
CREATE TABLE "ReferredSubscription" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "clickId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "firstPaymentRef" TEXT,
    "firstPaidAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReferredSubscription_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ReferredSubscription_merchantId_stripeSubscriptionId_key" ON "ReferredSubscription"("merchantId", "stripeSubscriptionId");

CREATE INDEX "ReferredSubscription_clickId_idx" ON "ReferredSubscription"("clickId");

ALTER TABLE "ReferredSubscription" ADD CONSTRAINT "ReferredSubscription_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ReferredSubscription" ADD CONSTRAINT "ReferredSubscription_clickId_fkey" FOREIGN KEY ("clickId") REFERENCES "Click"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Self referrals already confirmed before this release stop earning too. The
-- earliest confirmation on a click is when its referral was known to be fraud.
UPDATE "Click" AS c
SET "fraudConfirmedAt" = confirmed."at"
FROM (
    SELECT "clickId", MIN(COALESCE("voidedAt", "createdAt")) AS "at"
    FROM "Commission"
    WHERE "voidReason" = 'confirmed self-referral'
    GROUP BY "clickId"
) AS confirmed
WHERE c."id" = confirmed."clickId";

-- The upgrade cancels what those confirmed self referrals have not been paid
-- yet, the way confirmCommissionFraud cancels the rest of a click's unpaid
-- commissions when the Owner confirms it. PAID rows and adjustment rows are
-- left untouched: paid stays paid, and an adjustment is not a new commission.
UPDATE "Commission"
SET "status" = 'VOIDED', "voidReason" = 'confirmed self-referral', "voidedAt" = CURRENT_TIMESTAMP
WHERE "clickId" IN (SELECT "id" FROM "Click" WHERE "fraudConfirmedAt" IS NOT NULL)
  AND "adjustsCommissionId" IS NULL
  AND "status" IN ('PENDING', 'PAYABLE', 'FLAGGED');

-- No subscription ids are backfilled: the database never stored them. Clicks
-- linked by customer before this release are recognised from Stripe the first
-- time one of their events arrives (see referredSubscription.ts).
