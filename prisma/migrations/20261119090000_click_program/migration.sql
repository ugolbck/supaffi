-- A referral earns on the program it was made under, not the affiliate's
-- current one. Every click made before this is given its affiliate's program
-- today, which is what it was earning under until now.
ALTER TABLE "Click" ADD COLUMN "programId" TEXT;

UPDATE "Click" c
SET "programId" = a."programId"
FROM "Affiliate" a
WHERE c."affiliateId" = a."id";

ALTER TABLE "Click" ALTER COLUMN "programId" SET NOT NULL;

CREATE INDEX "Click_programId_idx" ON "Click"("programId");

ALTER TABLE "Click" ADD CONSTRAINT "Click_programId_fkey" FOREIGN KEY ("programId") REFERENCES "Program"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
