-- Emails sent through mail.platformServer, counted against the Owner's daily limit.
ALTER TABLE "Email" ADD COLUMN "sentByPlatform" BOOLEAN NOT NULL DEFAULT false;
