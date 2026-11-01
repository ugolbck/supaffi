-- AlterTable
ALTER TABLE "Program" ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "stripeCouponId" TEXT;

-- AlterTable
ALTER TABLE "AffiliatePromoCode" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "discountLabel" TEXT,
ADD COLUMN     "issued" BOOLEAN NOT NULL DEFAULT false;
