-- referredChargeMinor was an INTEGER, topping out at 2,147,483,647. A
-- wholly referred renewal in a zero-decimal currency (VND, IDR, ...) can
-- pass that on an ordinary sale, and the insert then failed. Widening to
-- BIGINT is a catalog change in Postgres: no table rewrite, no index
-- rebuild, a brief exclusive lock on "Commission" only. Existing values are
-- unchanged. Stripe's own amounts stay far below BIGINT's range and below
-- Number.MAX_SAFE_INTEGER too: "The amount value supports up to eight
-- digits (e.g., a value of 99999999 for a USD charge of $999,999.99)"
-- (Stripe docs, the PaymentIntent object, `amount`).
ALTER TABLE "Commission"
  ALTER COLUMN "referredChargeMinor" TYPE BIGINT;
