-- Which payment provider a product takes its payments through. Every
-- existing product is on Stripe, the only provider until now.
CREATE TYPE "PaymentProvider" AS ENUM ('STRIPE');

ALTER TABLE "Merchant" ADD COLUMN     "paymentProvider" "PaymentProvider" NOT NULL DEFAULT 'STRIPE';
