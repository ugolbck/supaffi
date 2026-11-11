import type { PaymentProvider } from "@prisma/client";
import type { PaymentProviderAdapter } from "@/lib/payments/types";
import { stripeProvider } from "@/lib/payments/stripe";
import { polarProvider } from "@/lib/payments/polar";

// Every provider Supaffi supports, keyed by the value stored on
// Merchant.paymentProvider. Adding a provider is a folder next to stripe/ and
// one line here.
const PROVIDERS: Record<PaymentProvider, PaymentProviderAdapter> = {
  STRIPE: stripeProvider,
  POLAR: polarProvider,
};

export const paymentProviders: readonly PaymentProviderAdapter[] = Object.values(PROVIDERS);

export function paymentProviderFor(merchant: { paymentProvider: PaymentProvider }): PaymentProviderAdapter {
  return PROVIDERS[merchant.paymentProvider];
}

/** The provider whose webhook address ends in this segment, if any. */
export function paymentProviderBySlug(slug: string): PaymentProviderAdapter | null {
  return paymentProviders.find((provider) => provider.webhookSlug === slug) ?? null;
}

/**
 * Text for any error the worker logs or stores. A provider's error becomes
 * its log-safe label, since the provider's own message can name the account
 * or a masked key; anything else keeps its own message.
 */
export function loggableError(err: unknown): string {
  return providerErrorLabel(err) ?? (err instanceof Error ? err.message : String(err));
}

/** The log-safe label of an error a provider's API threw, or null for any other error. */
export function providerErrorLabel(err: unknown): string | null {
  for (const provider of paymentProviders) {
    const label = provider.errorLabel(err);
    if (label) return label;
  }
  return null;
}
