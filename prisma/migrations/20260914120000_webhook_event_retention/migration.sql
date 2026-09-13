-- Daily cleanup of processed events older than 90 days keeps each product's
-- newest event, and checks for a newer one by product and time.
CREATE INDEX "WebhookEvent_merchantId_createdAt_idx" ON "WebhookEvent"("merchantId", "createdAt");
