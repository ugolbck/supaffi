-- The sale handlers read a click's earlier commissions on every sale of a
-- program with a limited duration, to know when the referral started and
-- whether it already earned. Postgres does not index foreign keys, so without
-- this that read scans every commission. An index only: no row changes.
CREATE INDEX "Commission_clickId_createdAt_idx" ON "Commission"("clickId", "createdAt");
