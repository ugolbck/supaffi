import { describe, it, expect, afterAll } from "vitest";
import { db } from "@/lib/db";

describe("webhook event retention schema", () => {
  afterAll(async () => {
    await db.$disconnect();
  });

  it("has the index cleanup uses to find a product's newer events", async () => {
    const rows = await db.$queryRaw<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'WebhookEvent'
    `;
    expect(rows.map((row) => row.indexname)).toContain("WebhookEvent_merchantId_createdAt_idx");
  });
});
