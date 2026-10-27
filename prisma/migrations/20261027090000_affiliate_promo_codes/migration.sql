-- Promo codes: a Stripe promotion code the Owner gives an Affiliate, and the
-- click a sale with that code stands in for. Every existing Click is a
-- visitor's and keeps both new columns null.
-- AlterTable
ALTER TABLE "Click" ADD COLUMN     "promoCheckoutSessionId" TEXT,
ADD COLUMN     "promoCodeId" TEXT;

-- CreateTable
CREATE TABLE "AffiliatePromoCode" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "stripePromotionCodeId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliatePromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AffiliatePromoCode_affiliateId_idx" ON "AffiliatePromoCode"("affiliateId");

-- CreateIndex
CREATE UNIQUE INDEX "AffiliatePromoCode_merchantId_stripePromotionCodeId_key" ON "AffiliatePromoCode"("merchantId", "stripePromotionCodeId");

-- CreateIndex
CREATE INDEX "Click_promoCodeId_idx" ON "Click"("promoCodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Click_affiliateId_promoCheckoutSessionId_key" ON "Click"("affiliateId", "promoCheckoutSessionId");

-- AddForeignKey
ALTER TABLE "Click" ADD CONSTRAINT "Click_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "AffiliatePromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePromoCode" ADD CONSTRAINT "AffiliatePromoCode_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AffiliatePromoCode" ADD CONSTRAINT "AffiliatePromoCode_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

