import { apiBase, checkSize, getJson, throttle } from "../http";
import { fromCents, type FetchedProgram, type SourceCommissionState } from "../types";

/**
 * FirstPromoter's API, v2: Bearer key plus the Account-ID header, numbered
 * pages, 400 requests a minute. Commission amounts are in cents. Payout
 * emails live on a separate endpoint, read per promoter.
 * https://docs.firstpromoter.com/api-reference-v2/api-admin/introduction
 */

type Campaign = { id: number; name: string; ref_token_param?: string | null };
type Promoter = {
  id: number;
  email: string;
  name: string | null;
  profile?: { first_name?: string | null; last_name?: string | null } | null;
  promoter_campaigns?: { campaign_id: number; ref_token: string | null }[];
};
type PayoutMethod = { method: string; is_selected?: boolean; details?: { paypal_email?: string; wise_email?: string } };
type Referral = { id: number; uid: string | null; created_at: string; promoter_campaign: { promoter_id: number } | null };
type Commission = {
  id: number;
  status: "pending" | "approved" | "denied";
  is_paid: boolean;
  amount: number;
  unit: string;
  created_at: string;
  status_updated_at: string | null;
  promoter_campaign: { promoter_id: number } | null;
  referral: { id: number } | null;
};

function stateOf(c: Commission): SourceCommissionState {
  if (c.status === "denied") return "void";
  if (c.is_paid) return "paid";
  return c.status === "approved" ? "owed" : "pending";
}

/**
 * `currency` is the account's: FirstPromoter's API does not say which
 * currency a commission is in, so the Owner names it when starting.
 */
export async function fetchFirstPromoter(apiKey: string, accountId: string, currency: string): Promise<FetchedProgram> {
  const base = apiBase("https://api.firstpromoter.com/api/v2/company");
  const headers = { authorization: `Bearer ${apiKey}`, "account-id": accountId };
  const wait = throttle(350, 60_000);

  async function all<T>(path: string, perPage: number): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page += 1) {
      await wait();
      const sep = path.includes("?") ? "&" : "?";
      const body = await getJson<T[] | { data: T[] }>(`${base}${path}${sep}per_page=${perPage}&page=${page}`, headers, "FirstPromoter");
      const data = Array.isArray(body) ? body : body.data;
      rows.push(...data);
      checkSize(rows, "FirstPromoter");
      if (data.length < perPage) return rows;
    }
  }

  const campaigns = await all<Campaign>("/campaigns", 50);
  const promoters = await all<Promoter>("/promoters", 100);
  const referrals = await all<Referral>("/referrals", 100);
  const commissions = await all<Commission>("/commissions", 100);

  const payout = new Map<number, { paypal: string | null; wise: string | null }>();
  for (const promoter of promoters) {
    const methods = await all<PayoutMethod>(`/payout_methods?filters[promoter_id]=${promoter.id}`, 100);
    const selected = methods.find((m) => m.is_selected) ?? methods[0];
    payout.set(promoter.id, {
      paypal: selected?.method === "paypal" ? (selected.details?.paypal_email ?? null) : null,
      wise: selected?.method === "wise" ? (selected.details?.wise_email ?? null) : null,
    });
  }

  const params = campaigns.map((c) => c.ref_token_param).filter((p): p is string => Boolean(p));
  const referralParam = params[0] ?? "fpr";

  return {
    referralParam: referralParam === "via" ? null : referralParam,
    campaigns: campaigns.map((c) => ({ id: String(c.id), name: c.name })),
    affiliates: promoters.map((p) => ({
      id: String(p.id),
      email: p.email,
      name: p.name || [p.profile?.first_name, p.profile?.last_name].filter(Boolean).join(" ") || null,
      campaignId: p.promoter_campaigns?.[0] ? String(p.promoter_campaigns[0].campaign_id) : null,
      codes: (p.promoter_campaigns ?? []).map((c) => c.ref_token).filter((t): t is string => Boolean(t)),
      paypalEmail: payout.get(p.id)?.paypal ?? null,
      wiseEmail: payout.get(p.id)?.wise ?? null,
    })),
    referrals: referrals
      .filter((r) => r.promoter_campaign)
      .map((r) => ({
        id: String(r.id),
        affiliateId: String(r.promoter_campaign!.promoter_id),
        // The customer id the site sent FirstPromoter, which is Stripe's when it starts with cus_.
        stripeCustomerId: r.uid?.startsWith("cus_") ? r.uid : null,
        subscriptionId: null,
        createdAt: r.created_at,
      })),
    // Only cash rewards: credits, points and free months are not money to pay out.
    commissions: commissions
      .filter((c) => c.unit === "cash" && c.promoter_campaign)
      .map((c) => ({
        id: String(c.id),
        affiliateId: String(c.promoter_campaign!.promoter_id),
        referralId: c.referral ? String(c.referral.id) : null,
        amount: fromCents(c.amount),
        currency,
        state: stateOf(c),
        createdAt: c.created_at,
        paidAt: c.is_paid ? (c.status_updated_at ?? c.created_at) : null,
      })),
  };
}
