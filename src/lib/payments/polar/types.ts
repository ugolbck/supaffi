// The parts of Polar's webhook payloads Supaffi reads, pinned to API version
// 2026-10 (api.ts). Amounts are integers in the currency's smallest unit.

type Metadata = Record<string, string | number | boolean> | null | undefined;

export type PolarOrder = {
  id: string;
  created_at: string;
  /** purchase, subscription_create, subscription_cycle, subscription_cycle_after_trial, subscription_update, subscription_meter_cycle, subscription_cancel */
  billing_reason: string;
  /** After discount, before tax. */
  net_amount: number;
  /** Cumulative, before tax. */
  refunded_amount: number;
  currency: string;
  subscription_id: string | null;
  product_id: string | null;
  checkout_id?: string | null;
  /** The discount the order used: an affiliate's code when it is one Supaffi knows. */
  discount_id?: string | null;
  metadata: Metadata;
  customer?: { email?: string | null; metadata?: Metadata } | null;
  subscription?: { metadata?: Metadata } | null;
};

export type PolarSubscription = { id: string };

export type PolarEvent = { type: string; data: unknown };

/** The exclusion flag (CONTEXT.md), wherever the owner set it. */
export function hasPolarExclusionFlag(...sources: Metadata[]): boolean {
  return sources.some((metadata) => metadata?.supaffi === "false" || metadata?.supaffi === false);
}
