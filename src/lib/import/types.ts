/**
 * Another tool's affiliate program, read through its API and put in one shape
 * whatever the tool, so previewing and writing it never depend on which tool
 * it came from. Ids are the other tool's own, as strings. Pure, so the import
 * page can read it in the browser.
 */

export type ImportSourceKey = "REWARDFUL" | "TOLT" | "FIRSTPROMOTER" | "AFFONSO";

export const IMPORT_SOURCES: Record<
  ImportSourceKey,
  {
    label: string;
    /** The query parameter its referral links carry. Null when it is `via`, as ours is. */
    referralParam: string | null;
    /** Whether its API asks for an account id beside the key, and says no currency, so the Owner names both. */
    needsAccountId: boolean;
    /** Where its owner finds the API key. */
    keyHelp: string;
  }
> = {
  REWARDFUL: {
    label: "Rewardful",
    referralParam: null,
    needsAccountId: false,
    keyHelp: "Company settings, API Secret",
  },
  TOLT: { label: "Tolt", referralParam: "ref", needsAccountId: false, keyHelp: "Settings, Integrations, API" },
  FIRSTPROMOTER: {
    label: "FirstPromoter",
    referralParam: "fpr",
    needsAccountId: true,
    keyHelp: "Settings, Integrations, Manage API keys",
  },
  AFFONSO: { label: "Affonso", referralParam: "atp", needsAccountId: false, keyHelp: "Settings, API keys" },
};

export function isImportSource(value: unknown): value is ImportSourceKey {
  return typeof value === "string" && Object.hasOwn(IMPORT_SOURCES, value);
}

export type SourceCampaign = { id: string; name: string };

export type SourceAffiliate = {
  id: string;
  email: string;
  name: string | null;
  campaignId: string | null;
  /** Every referral code the affiliate's links use, primary first. */
  codes: string[];
  paypalEmail: string | null;
  wiseEmail: string | null;
};

/** One referred customer. */
export type SourceReferral = {
  id: string;
  affiliateId: string;
  /** The Stripe customer, when the tool knows it. */
  stripeCustomerId: string | null;
  /** The subscription renewals arrive on, when the tool knows it. */
  subscriptionId: string | null;
  createdAt: string;
};

export type SourceCommissionState = "pending" | "owed" | "paid" | "void";

export type SourceCommission = {
  id: string;
  affiliateId: string;
  referralId: string | null;
  /** Major units, two decimals. */
  amount: string;
  /** Lowercase ISO code. */
  currency: string;
  state: SourceCommissionState;
  createdAt: string;
  paidAt: string | null;
};

export type FetchedProgram = {
  /** The query parameter the links carry, when the tool says. Else the tool's default. */
  referralParam?: string | null;
  campaigns: SourceCampaign[];
  affiliates: SourceAffiliate[];
  referrals: SourceReferral[];
  commissions: SourceCommission[];
};

/** Campaign id to program id. */
export type CampaignMapping = Record<string, string>;

export type ImportSummary = {
  /** Who the import wrote, so only they are invited. */
  createdAffiliateIds: string[];
  affiliatesCreated: number;
  affiliatesMatched: number;
  /** Codes another product already uses: those affiliates got a new code. */
  codesTaken: string[];
  /** Codes that are not a valid code here even lowercased: those links stop working. */
  codesInvalid: string[];
  referrals: number;
  /** Renewals of these referrals will earn here. */
  subscriptionsLinked: number;
  commissionsOwed: number;
  commissionsPaid: number;
  /** Already imported by an earlier run, left as they were. */
  commissionsSkipped: number;
};

/** Major units with two decimals from an amount in cents. */
export function fromCents(cents: number): string {
  return (Math.round(cents) / 100).toFixed(2);
}

/** Two decimals from an amount in major units, as a number or a string. */
export function fromMajor(amount: number | string): string {
  const value = typeof amount === "string" ? Number(amount) : amount;
  return Number.isFinite(value) ? value.toFixed(2) : "0.00";
}
