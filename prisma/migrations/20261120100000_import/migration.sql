-- Imports from another affiliate tool, and the referral parameter its links
-- carried, which the tracking script keeps reading.
-- CreateEnum
CREATE TYPE "ImportSource" AS ENUM ('REWARDFUL', 'TOLT', 'FIRSTPROMOTER', 'AFFONSO');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('FETCHING', 'READY', 'IMPORTING', 'DONE', 'FAILED');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "legacyReferralParam" TEXT;

-- CreateTable
CREATE TABLE "Import" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "source" "ImportSource" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'FETCHING',
    "apiKeyEnc" TEXT,
    "accountRef" TEXT,
    "fetched" JSONB,
    "mapping" JSONB,
    "summary" JSONB,
    "error" TEXT,
    "claimedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Import_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Import_merchantId_createdAt_idx" ON "Import"("merchantId", "createdAt");

-- CreateIndex
CREATE INDEX "Import_status_idx" ON "Import"("status");

-- AddForeignKey
ALTER TABLE "Import" ADD CONSTRAINT "Import_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

