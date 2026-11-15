// The Polar events Supaffi handles, and the events its webhook endpoint is
// created with. dispatch.ts keys its handlers by this list.
//
// order.paid fires once, when an order becomes paid: a checkout's first order
// and every renewal (polar.sh/docs/integrate/webhooks/events). Refunds,
// partial ones included, end with order.refunded carrying the order's
// cumulative refunded amount. subscription.revoked is the real end of a
// subscription; subscription.canceled only schedules it.
export const POLAR_WEBHOOK_EVENTS = ["order.paid", "order.refunded", "subscription.revoked"] as const;

export function polarWebhookUrl(domain: string): string {
  return `https://${domain}/api/webhooks/polar`;
}

/** The Polar dashboard the product's token belongs to: the sandbox is a site of its own. */
export function polarDashboardUrl(sandbox: boolean): string {
  return sandbox ? "https://sandbox.polar.sh/dashboard" : "https://polar.sh/dashboard";
}
