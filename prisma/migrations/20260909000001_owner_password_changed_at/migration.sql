-- Owner.passwordChangedAt: when the password was last changed. Sessions are
-- JWTs with no adapter, so nothing else can end a session that was issued
-- before the change; every owner session is checked against this stamp.
-- Null on owners who have never changed their password.
ALTER TABLE "Owner" ADD COLUMN "passwordChangedAt" TIMESTAMP(3);
