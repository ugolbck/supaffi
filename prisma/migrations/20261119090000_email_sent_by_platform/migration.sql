-- Emails sent through mail.platformServer, counted against the Owner's daily limit.
ALTER TABLE "Email" ADD COLUMN "sentByPlatform" BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "Email_sentByPlatform_merchantId_sentAt_idx" ON "Email"("sentByPlatform", "merchantId", "sentAt");
