-- Polar as a second payment provider. A Polar token works on either its
-- sandbox or production, never both, so the product remembers which.
ALTER TYPE "PaymentProvider" ADD VALUE 'POLAR';

ALTER TABLE "Merchant" ADD COLUMN     "paymentSandbox" BOOLEAN NOT NULL DEFAULT false;
