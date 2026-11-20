import { apiBase, checkSize, getJson, throttle } from "../http";
import { fromCents, type FetchedProgram, type SourceCommissionState } from "../types";

/**
 * Rewardful's REST API, v1: Basic auth with the API Secret as the user, pages
 * of at most 100 newest first, 45 requests every 30 seconds.
 * https://developers.rewardful.com/rest-api/overview
 */

type Page<T> = { pagination?: { next_page: number | null }; data: T[] } | T[];

type Campaign = { id: string; name: string };
type Affiliate = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  paypal_email: string | null;
  wise_email?: string | null;
  campaign: { id: string } | null;
  links?: { token: string }[];
};
type Referral = { id: string; stripe_customer_id: string | null; affiliate: { id: string } | null; created_at: string; became_conversion_at: string | null };
type Commission = {
  id: string;
  amount: number;
  currency: string;
  state: "pending" | "due" | "paid" | "voided";
  created_at: string;
  paid_at: string | null;
  sale: { affiliate: { id: string } | null; referral: { id: string } | null } | null;
};

const STATES: Record<Commission["state"], SourceCommissionState> = {
  pending: "pending",
  due: "owed",
  paid: "paid",
  voided: "void",
};

export async function fetchRewardful(apiKey: string): Promise<FetchedProgram> {
  const base = apiBase("https://api.getrewardful.com/v1");
  const headers = { authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}` };
  const wait = throttle(40, 30_000);

  async function all<T>(path: string, query: string): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page += 1) {
      await wait();
      const body = await getJson<Page<T>>(`${base}${path}?limit=100&page=${page}${query}`, headers, "Rewardful");
      if (Array.isArray(body)) return [...rows, ...body];
      rows.push(...body.data);
      checkSize(rows, "Rewardful");
      if (!body.pagination?.next_page || body.data.length === 0) return rows;
    }
  }

  const campaigns = await all<Campaign>("/campaigns", "");
  const affiliates = await all<Affiliate>("/affiliates", "&expand[]=links");
  const referrals = await all<Referral>("/referrals", "&conversion_state[]=conversion");
  const commissions = await all<Commission>("/commissions", "&expand[]=sale");

  return {
    campaigns: campaigns.map((c) => ({ id: c.id, name: c.name })),
    affiliates: affiliates.map((a) => ({
      id: a.id,
      email: a.email,
      name: [a.first_name, a.last_name].filter(Boolean).join(" ") || null,
      campaignId: a.campaign?.id ?? null,
      codes: (a.links ?? []).map((l) => l.token).filter(Boolean),
      paypalEmail: a.paypal_email ?? null,
      wiseEmail: a.wise_email ?? null,
    })),
    referrals: referrals
      .filter((r) => r.affiliate)
      .map((r) => ({
        id: r.id,
        affiliateId: r.affiliate!.id,
        stripeCustomerId: r.stripe_customer_id ?? null,
        subscriptionId: null,
        createdAt: r.became_conversion_at ?? r.created_at,
      })),
    commissions: commissions
      .filter((c) => c.sale?.affiliate)
      .map((c) => ({
        id: c.id,
        affiliateId: c.sale!.affiliate!.id,
        referralId: c.sale!.referral?.id ?? null,
        amount: fromCents(c.amount),
        currency: c.currency.toLowerCase(),
        state: STATES[c.state] ?? "void",
        createdAt: c.created_at,
        paidAt: c.paid_at,
      })),
  };
}
