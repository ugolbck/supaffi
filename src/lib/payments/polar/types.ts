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
  /**
   * The customer's balance used on the order: negative when their credit paid
   * part of it, positive when it collected an amount they owed.
   */
  applied_balance_amount?: number;
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

/**
 * What the customer paid before tax: the net amount with their balance
 * applied. Polar refunds up to this figure and marks the order fully refunded
 * at it (Order.refundable_amount in polar/models/order.py).
 */
export function polarPaidAmount(order: PolarOrder): number {
  return Math.max(0, order.net_amount + (order.applied_balance_amount ?? 0));
}

/** The exclusion flag (CONTEXT.md), wherever the owner set it. */
export function hasPolarExclusionFlag(...sources: Metadata[]): boolean {
  return sources.some((metadata) => metadata?.supaffi === "false" || metadata?.supaffi === false);
}
