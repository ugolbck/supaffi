-- CreateEnum
CREATE TYPE "EmailStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED');

-- AlterTable
ALTER TABLE "Merchant" ADD COLUMN     "emailAffiliates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "emailFailedAt" TIMESTAMP(3),
ADD COLUMN     "emailFailure" TEXT,
ADD COLUMN     "mailFrom" TEXT,
ADD COLUMN     "notifyNewAffiliates" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "notifyNewSales" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "smtpHost" TEXT,
ADD COLUMN     "smtpPasswordEnc" TEXT,
ADD COLUMN     "smtpPort" INTEGER,
ADD COLUMN     "smtpUser" TEXT;

-- CreateTable
CREATE TABLE "Email" (
    "id" TEXT NOT NULL,
    "merchantId" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "to" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "status" "EmailStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Email_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Email_status_nextAttemptAt_idx" ON "Email"("status", "nextAttemptAt");

-- CreateIndex
CREATE UNIQUE INDEX "Email_merchantId_dedupeKey_key" ON "Email"("merchantId", "dedupeKey");

-- AddForeignKey
ALTER TABLE "Email" ADD CONSTRAINT "Email_merchantId_fkey" FOREIGN KEY ("merchantId") REFERENCES "Merchant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

