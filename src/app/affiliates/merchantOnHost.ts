import { cache } from "react";
import { redirect } from "next/navigation";
import { ext } from "@/extensions";
import { getMerchantByDomain } from "@/lib/merchant";

// The one way an affiliate page or server action finds its product. A layout
// does not run for server actions, so each one carries the call itself.
// test/app/affiliates/merchantOnHost.test.ts refuses a file that skips it.

export const PAUSED_PATH = "/affiliates/paused";

/** The product on a host and whether owners.serves lets it be served, once per request. */
export const productOnHost = cache(async (host: string | null) => {
  const merchant = host ? await getMerchantByDomain(host) : null;
  const served = merchant ? await ext.owners.serves(merchant.ownerId) : true;
  return { merchant, served };
});

/**
 * The product on a host, or null for none. A product owners.serves turns
 * away sends the visitor to the paused page instead, so nothing after this
 * call reads or writes.
 */
export async function merchantOnHost(host: string | null) {
  const { merchant, served } = await productOnHost(host);
  if (!served) redirect(PAUSED_PATH);
  return merchant;
}
