-- Decimal(10,2) topped out at 99,999,999.99, which a single sale in a
-- currency such as the Vietnamese dong or Indonesian rupiah can pass, and the
-- insert then failed. Widening precision while keeping the scale is a catalog
-- change in Postgres: no table rewrite, no index rebuild, a brief exclusive
-- lock on "Commission" only. Existing values are unchanged.
ALTER TABLE "Commission"
  ALTER COLUMN "amount" TYPE DECIMAL(18,2),
  ALTER COLUMN "saleAmount" TYPE DECIMAL(18,2),
  ALTER COLUMN "grossAmount" TYPE DECIMAL(18,2);
