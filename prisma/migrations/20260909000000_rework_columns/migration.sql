-- Commission.saleAmount: what the customer paid, in major units, same
-- currency as `amount`. Null on adjustment rows and on every commission that
-- existed before this column, which the revenue chart must treat as unknown
-- rather than zero.
ALTER TABLE "Commission" ADD COLUMN "saleAmount" DECIMAL(10,2);

-- Merchant.onboardingCompletedAt: set when the owner leaves the last
-- onboarding screen. Distinct from "every step is done", which can be true
-- of a product whose owner never saw the final screen.
ALTER TABLE "Merchant" ADD COLUMN "onboardingCompletedAt" TIMESTAMP(3);

-- Merchant.welcomeDismissedAt: the first-visit banner on the overview, shown
-- until this is set or a first affiliate signs up, whichever is first.
ALTER TABLE "Merchant" ADD COLUMN "welcomeDismissedAt" TIMESTAMP(3);
