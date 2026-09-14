-- The referred share of the charge, in Stripe minor units, capped at the
-- charge amount. Set at creation for a renewal so a refund prorates against
-- only the revenue that earned, never against a one-off item or another
-- product billed on the same charge. Additive and nullable: rows without it
-- (checkout rows, rows written before this release) keep the whole-charge
-- proration they always used.
ALTER TABLE "Commission" ADD COLUMN "referredChargeMinor" INTEGER;
