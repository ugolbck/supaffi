-- AlterTable
ALTER TABLE "Merchant" ALTER COLUMN "stripeSecretKeyEnc" DROP NOT NULL,
ALTER COLUMN "stripeWebhookSecretEnc" DROP NOT NULL,
ALTER COLUMN "emailProviderConfigEnc" DROP NOT NULL;
