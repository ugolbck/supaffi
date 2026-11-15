-- With ownership proof required, a product moving to a new domain keeps
-- serving its proven one until the new one is proven.
ALTER TABLE "Merchant" ADD COLUMN     "previousDomain" TEXT;

CREATE UNIQUE INDEX "Merchant_previousDomain_key" ON "Merchant"("previousDomain");
