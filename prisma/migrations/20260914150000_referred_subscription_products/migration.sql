-- The Stripe products a referred checkout bought. A renewal earns only on the
-- subscription's own lines for these products. Additive with an empty default,
-- so rows written before this release read as "not known yet" and take their
-- products from their next renewal (see referredRevenue.ts).
ALTER TABLE "ReferredSubscription" ADD COLUMN "stripeProductIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
