import { db } from "@/lib/db";
import { isLocalDomain } from "@/lib/url";

// Whether a request arrived on a product's affiliate domain rather than the
// dashboard's. A local host is never one: in development the dashboard and a
// product share localhost. Imports only the database client and url helpers,
// so the proxy can use it.
export async function isMerchantDomain(host: string | null): Promise<boolean> {
  if (!host || isLocalDomain(host)) return false;
  const merchant = await db.merchant.findUnique({ where: { domain: host.toLowerCase() }, select: { id: true } });
  return merchant !== null;
}
