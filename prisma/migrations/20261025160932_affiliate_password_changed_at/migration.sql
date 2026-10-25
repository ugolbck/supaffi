-- When a password link replaces an Affiliate's password, sessions issued
-- before that moment stop working. Null for every existing Affiliate, which
-- leaves their current sessions valid.
ALTER TABLE "Affiliate" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
