import { apiBase, getJson, throttle } from "../http";
import { fromCents, type FetchedProgram, type SourceCommissionState } from "../types";

/**
 * Tolt's API, v2: Bearer key, cursor pages of at most 100, 25 requests a
 * second. Money is minor units sent as strings. It exposes no payout details
 * and no paid date. https://docs.tolt.com/api-reference/introduction
 */

type Page<T> = { data: T[]; has_more?: boolean; next_cursor?: string | null };

type Program = { id: string; name: string };
type Partner = { id: string; email: string; first_name: string | null; last_name: string | null; program_id: string | null };
type Link = { value: string; param: string | null; partner_id: string };
type Customer = { id: string; partner_id: string | null; customer_id: string | null; subscription_id: string | null; created_at: string };
type Commission = {
  id: string;
  amount: string;
  currency: string;
  status: string;
  partner_id: string;
  customer_id: string | null;
  created_at: string;
  updated_at: string | null;
};

function stateOf(status: string): SourceCommissionState {
  if (status === "paid") return "paid";
  if (status === "approved") return "owed";
  if (status === "pending") return "pending";
  return "void";
}

export async function fetchTolt(apiKey: string): Promise<FetchedProgram> {
  const base = apiBase("https://platform.tolt.com/v2");
  const headers = { authorization: `Bearer ${apiKey}` };
  const wait = throttle(20, 1_000);

  async function all<T>(path: string): Promise<T[]> {
    const rows: T[] = [];
    let after: string | null = null;
    for (;;) {
      await wait();
      const url: string = `${base}${path}?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`;
      const body = await getJson<Page<T>>(url, headers, "Tolt");
      rows.push(...body.data);
      if (!body.has_more || !body.next_cursor) return rows;
      after = body.next_cursor;
    }
  }

  const programs = await all<Program>("/programs");
  const partners = await all<Partner>("/partners");
  const links = await all<Link>("/links");
  const customers = await all<Customer>("/customers");
  const commissions = await all<Commission>("/commissions");

  const codes = new Map<string, string[]>();
  const params = new Map<string, number>();
  for (const link of links) {
    codes.set(link.partner_id, [...(codes.get(link.partner_id) ?? []), link.value]);
    if (link.param) params.set(link.param, (params.get(link.param) ?? 0) + 1);
  }
  // Each link keeps its own parameter; the one most links use is the one to keep reading.
  const referralParam = [...params].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "ref";

  return {
    referralParam: referralParam === "via" ? null : referralParam,
    campaigns: programs.map((p) => ({ id: p.id, name: p.name })),
    affiliates: partners.map((p) => ({
      id: p.id,
      email: p.email,
      name: [p.first_name, p.last_name].filter(Boolean).join(" ") || null,
      campaignId: p.program_id,
      codes: codes.get(p.id) ?? [],
      paypalEmail: null,
      wiseEmail: null,
    })),
    referrals: customers
      .filter((c) => c.partner_id)
      .map((c) => ({
        id: c.id,
        affiliateId: c.partner_id!,
        stripeCustomerId: c.customer_id?.startsWith("cus_") ? c.customer_id : null,
        subscriptionId: c.subscription_id ?? null,
        createdAt: c.created_at,
      })),
    commissions: commissions.map((c) => ({
      id: c.id,
      affiliateId: c.partner_id,
      referralId: c.customer_id,
      amount: fromCents(Number(c.amount)),
      currency: c.currency.toLowerCase(),
      state: stateOf(c.status),
      createdAt: c.created_at,
      // Tolt records no paid date; its last change is the closest it has.
      paidAt: c.status === "paid" ? (c.updated_at ?? c.created_at) : null,
    })),
  };
}
