import type Stripe from "stripe";

type ApiLocation = Pick<Stripe.StripeConfig, "host" | "port" | "protocol">;

// Where the Stripe API lives. Unset on every real install, which leaves the
// SDK on api.stripe.com. The end-to-end suite points it at its fake Stripe
// (e2e/), the only way to run the whole chain without a real account.
export function stripeApiLocation(): ApiLocation {
  const base = process.env.SUPAFFI_STRIPE_API_BASE?.trim();
  if (!base) return {};
  const url = new URL(base);
  const protocol = url.protocol === "http:" ? "http" : "https";
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : protocol === "http" ? 80 : 443,
    protocol,
  };
}
