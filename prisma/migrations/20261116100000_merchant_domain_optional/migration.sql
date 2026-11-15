-- A product's unproven domain can be taken by another Owner's claim, when
-- ownership proof is required. The product then has none until a new one is set.
ALTER TABLE "Merchant" ALTER COLUMN "domain" DROP NOT NULL;
