ALTER TABLE "Commission" ADD COLUMN "grossAmount" DECIMAL(10,2);
UPDATE "Commission" SET "grossAmount" = "amount" WHERE "grossAmount" IS NULL;
