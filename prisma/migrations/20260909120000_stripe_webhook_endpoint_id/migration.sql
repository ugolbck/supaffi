-- The id Stripe gives the webhook endpoint Supaffi creates for a Merchant.
-- Stored so a second run of the connect flow updates that endpoint instead of
-- creating a duplicate one, which would double every event.
ALTER TABLE "Merchant" ADD COLUMN "stripeWebhookEndpointId" TEXT;
