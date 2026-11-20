-- Whether a commission's sale was made in live mode. Rows written before this
-- are taken as live: the column did not exist to say otherwise.
ALTER TABLE "Commission" ADD COLUMN "livemode" BOOLEAN NOT NULL DEFAULT true;
