-- CreateTable
CREATE TABLE "AffiliateLoginToken" (
    "id" TEXT NOT NULL,
    "affiliateId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AffiliateLoginToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AffiliateLoginToken_tokenHash_key" ON "AffiliateLoginToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AffiliateLoginToken_affiliateId_idx" ON "AffiliateLoginToken"("affiliateId");

-- AddForeignKey
ALTER TABLE "AffiliateLoginToken" ADD CONSTRAINT "AffiliateLoginToken_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
