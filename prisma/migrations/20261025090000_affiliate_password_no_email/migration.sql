-- Affiliates log in with a password instead of an emailed link, so the
-- instance no longer sends email. The stored Resend keys go with it, and every
-- unused emailed link is void: a remaining row would otherwise read as a live
-- password link.
ALTER TABLE "Affiliate" ADD COLUMN "passwordHash" TEXT;
ALTER TABLE "Merchant" DROP COLUMN "emailProviderConfigEnc";
DELETE FROM "AffiliateLoginToken";
