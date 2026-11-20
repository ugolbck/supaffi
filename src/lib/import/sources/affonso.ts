import { apiBase, getJson, throttle } from "../http";
import { fromMajor, type FetchedProgram, type SourceCommissionState } from "../types";

/**
 * Affonso's API, v1: Bearer key, one program per key. Numbered pages of up to
 * 200 for affiliates and commissions, cursor pages for referrals. Amounts are
 * major units. https://docs.affonso.io/api/introduction
 */

type Numbered<T> = { data: T[]; pagination?: { hasNextPage?: boolean; has_next_page?: boolean } };
type Cursor<T> = { data: T[]; has_more?: boolean };

type Program = { id: string; name: string; default_referral_parameter?: string | null };
type Affiliate = {
  id: string;
  name: string | null;
  email: string;
  tracking_id: string | null;
  payoutMethod?: { type: string; details?: { email?: string } } | null;
};
type Referral = {
  id: string;
  affiliate_id: string;
  customer_id: string | null;
  subscription_id: string | null;
  created_at: string;
  converted_at: string | null;
};
type Commission = {
  id: string;
  referral_id: string | null;
  affiliate_id: string;
  commission_amount: number | string;
  commission_currency: string;
  status: string;
  created_at: string;
  updated_at: string | null;
};

function stateOf(status: string): SourceCommissionState {
  if (status === "paid") return "paid";
  if (status === "ready_for_payment") return "owed";
  if (status === "pending" || status === "pending_manual_approval") return "pending";
  return "void";
}

export async function fetchAffonso(apiKey: string): Promise<FetchedProgram> {
  const base = apiBase("https://api.affonso.io/v1");
  const headers = { authorization: `Bearer ${apiKey}` };
  const wait = throttle(250, 60_000);

  async function numbered<T>(path: string, query = ""): Promise<T[]> {
    const rows: T[] = [];
    for (let page = 1; ; page += 1) {
      await wait();
      const body = await getJson<Numbered<T>>(`${base}${path}?limit=200&page=${page}${query}`, headers, "Affonso");
      rows.push(...body.data);
      if (!(body.pagination?.hasNextPage ?? body.pagination?.has_next_page)) return rows;
    }
  }

  async function cursor<T extends { id: string }>(path: string): Promise<T[]> {
    const rows: T[] = [];
    for (;;) {
      await wait();
      const after = rows.at(-1)?.id;
      const body = await getJson<Cursor<T>>(
        `${base}${path}?limit=100${after ? `&starting_after=${encodeURIComponent(after)}` : ""}`,
        headers,
        "Affonso"
      );
      rows.push(...body.data);
      if (!body.has_more || body.data.length === 0) return rows;
    }
  }

  await wait();
  const program = (await getJson<{ data: Program }>(`${base}/program`, headers, "Affonso")).data;
  const affiliates = await numbered<Affiliate>("/affiliates", "&expand=payoutMethod");
  const referrals = await cursor<Referral>("/referrals");
  const commissions = await numbered<Commission>("/commissions");

  const param = program.default_referral_parameter || "atp";
  return {
    referralParam: param === "via" ? null : param,
    campaigns: [{ id: program.id, name: program.name }],
    affiliates: affiliates.map((a) => ({
      id: a.id,
      email: a.email,
      name: a.name,
      campaignId: program.id,
      codes: a.tracking_id ? [a.tracking_id] : [],
      paypalEmail: a.payoutMethod?.type === "paypal" ? (a.payoutMethod.details?.email ?? null) : null,
      wiseEmail: a.payoutMethod?.type === "wise" ? (a.payoutMethod.details?.email ?? null) : null,
    })),
    referrals: referrals.map((r) => ({
      id: r.id,
      affiliateId: r.affiliate_id,
      stripeCustomerId: r.customer_id?.startsWith("cus_") ? r.customer_id : null,
      subscriptionId: r.subscription_id?.startsWith("sub_") ? r.subscription_id : null,
      createdAt: r.converted_at ?? r.created_at,
    })),
    commissions: commissions.map((c) => ({
      id: c.id,
      affiliateId: c.affiliate_id,
      referralId: c.referral_id,
      amount: fromMajor(c.commission_amount),
      currency: c.commission_currency.toLowerCase(),
      state: stateOf(c.status),
      createdAt: c.created_at,
      paidAt: c.status === "paid" ? (c.updated_at ?? c.created_at) : null,
    })),
  };
}
