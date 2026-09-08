import Stripe from "stripe";
import { db } from "@/lib/db";
import type { CheckResult } from "@/lib/checks/dns";

type MinimalStripe = { customers: { list: (params: { limit: number }) => Promise<unknown> } };

function defaultClient(key: string): MinimalStripe {
  return new Stripe(key) as unknown as MinimalStripe;
}

/**
 * One read with the key, before it is stored. Customers is the first
 * permission on the restricted key link, so a key made from that link passes
 * and a key made by hand with the wrong rows fails here rather than on the
 * first sale.
 */
export async function stripeKeyWorks(
  secretKey: string,
  makeClient: (key: string) => MinimalStripe = defaultClient
): Promise<CheckResult> {
  if (!/^(rk|sk)_(live|test)_/.test(secretKey)) {
    return { ok: false, detail: "That is not a Stripe secret or restricted key" };
  }
  try {
    await makeClient(secretKey).customers.list({ limit: 1 });
    return { ok: true, detail: "Key works" };
  } catch (err) {
    const type = (err as { type?: string })?.type ?? "";
    if (type === "StripePermissionError") {
      return { ok: false, detail: "The key is missing a permission. Create it from the button above." };
    }
    if (type === "StripeAuthenticationError") {
      return { ok: false, detail: "Stripe says this key is not valid" };
    }
    return { ok: false, detail: "Could not reach Stripe" };
  }
}

/** Whether Stripe has delivered any event at all to this product's endpoint. */
export async function webhookEventReceived(merchantId: string): Promise<CheckResult> {
  const any = await db.webhookEvent.findFirst({ where: { merchantId }, select: { id: true } });
  return any
    ? { ok: true, detail: "Stripe is sending events" }
    : { ok: false, detail: "Waiting for the first event" };
}
