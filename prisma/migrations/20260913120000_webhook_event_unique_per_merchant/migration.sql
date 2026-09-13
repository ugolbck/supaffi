-- A Stripe event id is unique per Stripe account, and two products on one
-- account each receive their own copy. Deduplicate per Merchant instead.
DROP INDEX "WebhookEvent_stripeEventId_key";

CREATE UNIQUE INDEX "WebhookEvent_merchantId_stripeEventId_key" ON "WebhookEvent"("merchantId", "stripeEventId");
