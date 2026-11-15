-- A payment reference is unique within one product, not across every product
-- in the database. The product is copied onto each commission from its
-- affiliate, which never moves between products. Every existing reference was
-- unique across the whole table, so it is unique per product too.

-- AlterTable
ALTER TABLE "Commission" ADD COLUMN "merchantId" TEXT;

UPDATE "Commission" c
SET "merchantId" = a."merchantId"
FROM "Affiliate" a
WHERE a.id = c."affiliateId";

ALTER TABLE "Commission" ALTER COLUMN "merchantId" SET NOT NULL;

-- DropIndex
DROP INDEX "Commission_stripePaymentRef_key";

-- CreateIndex
CREATE UNIQUE INDEX "Commission_merchantId_stripePaymentRef_key" ON "Commission"("merchantId", "stripePaymentRef");

-- AddForeignKey
ALTER TABLE "Commission" ADD CONSTRAINT "Commission_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
