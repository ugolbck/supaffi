-- A paid commission is final: a refund or lost chargeback after payout is no
-- longer taken off the affiliate's next payout. Adjustment rows an older
-- version left waiting to come off a payout are voided, so no payout, total or
-- badge counts them. Paid adjustment rows are history and stay as they are.
UPDATE "Commission"
SET "status" = 'VOIDED',
    "voidedAt" = (now() AT TIME ZONE 'UTC'),
    "voidReason" = 'refund after payout'
WHERE "adjustsCommissionId" IS NOT NULL
  AND "status" IN ('PENDING', 'PAYABLE', 'FLAGGED');
