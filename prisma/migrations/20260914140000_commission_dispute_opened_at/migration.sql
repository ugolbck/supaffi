-- An open dispute holds its commission back from payment. This is the moment
-- the hold began, null when no dispute is open. Additive and nullable, so every
-- existing row reads as undisputed. TIMESTAMP(3) without time zone, written in
-- UTC by the app, like every other date column on this table.
ALTER TABLE "Commission" ADD COLUMN "disputeOpenedAt" TIMESTAMP(3);
