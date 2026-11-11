import { db } from "@/lib/db";

/**
 * The ownership check behind every Owner read and write that names a product
 * by id. Scoped by both id and ownerId, never a bare findUnique(id): an id
 * arrives from the browser, and on its own it would reach another Owner's
 * product just as easily as this one's.
 *
 * Everything that hangs off a product (affiliates, programs, commissions,
 * payouts, settings) is then read with `merchantId` in its own query, so a
 * nested id from a form or a URL matches nothing outside the product checked
 * here.
 */
export async function assertOwnsMerchant(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}
