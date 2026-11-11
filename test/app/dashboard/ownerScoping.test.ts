// An Owner only reaches their own products and data. Two Owners, each with a
// product under the same slug; the session is the second Owner throughout,
// and every screen's reads and every Server Action are pointed at the first
// Owner's product, or at the second Owner's own product with the first
// Owner's nested ids (affiliate, commission, program, promo code). Each one
// has to refuse with its own specific answer or come back empty, and the first
// Owner's rows must not move. The last block runs the same action families as
// the first Owner, so every refusal above is about ownership alone. An
// affiliate session is held to the product whose host it is on.
//
// Destructive on its own rows only. Runs against the scratch DATABASE_URL.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const session = { user: { id: "", role: "owner" as "owner" | "affiliate" } };
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
// The host an affiliate screen is requested on.
const request = { host: "" };
vi.mock("@/lib/requestHost", () => ({ requestHost: async () => request.host }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`redirect:${url}`);
  },
  notFound: () => {
    throw new Error("notFound");
  },
}));
// Nothing here should reach Stripe: a key check passes so the ownership check
// behind it is what answers, and the webhook helpers are spied on to prove the
// refused writes never got as far as them.
vi.mock("@/lib/checks/stripe", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/checks/stripe")>()),
  stripeKeyWorks: async () => ({ ok: true, detail: "ok" }),
}));
const upgradeSpy = vi.fn();
const moveSpy = vi.fn();
vi.mock("@/lib/worker/webhookEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/worker/webhookEvents")>()),
  upgradeMerchantWebhookEvents: (...args: unknown[]) => upgradeSpy(...args),
  moveMerchantWebhookEndpoint: (...args: unknown[]) => moveSpy(...args),
}));
const createEndpointSpy = vi.fn();
vi.mock("@/lib/stripeWebhookEndpoint", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/stripeWebhookEndpoint")>()),
  createWebhookEndpoint: (...args: unknown[]) => createEndpointSpy(...args),
}));

import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";
import {
  deleteMerchant,
  getIntegrationStatus,
  getMerchantForOwner,
  getMerchantForOwnerBySlug,
  getOnboardingState,
  getStripeKeyKind,
  getStripeWebhookEndpointId,
  listMerchantsForOwner,
} from "@/lib/merchant";
import { getProductSetup } from "@/lib/productSetup";
import { runProductChecks } from "@/lib/checks/product";
import { getAffiliateDetails, getAffiliateSignals, listAffiliatesForMerchant } from "@/lib/affiliate";
import { getCommissionFilterOptions, getCommissionTotals, listCommissions } from "@/lib/commission";
import {
  getOwedTotals,
  getPayableGroups,
  getProductMetrics,
  getTopAffiliates,
  getWebhookHealth,
  listPayouts,
} from "@/lib/analytics";
import { couponsForProgramForm, getProgramForMerchant, listProgramsForMerchant } from "@/lib/program";
import { mailStatus } from "@/lib/mail";
import {
  addPromoCodeAction,
  changeProgramAction,
  createPasswordLinkAction,
  issuePromoCodeAction,
  setCustomRateAction,
  turnOffPromoCodeAction,
} from "@/app/dashboard/products/[product]/affiliates/affiliateActions";
import {
  confirmFraudAction,
  dismissFlagAction,
  markPaidAction,
  voidAction,
} from "@/app/dashboard/products/[product]/commissions/commissionActions";
import { markPayoutPaidAction } from "@/app/dashboard/products/[product]/payouts/payoutActions";
import { createProgramAction, updateProgramAction } from "@/app/dashboard/products/[product]/programs/programActions";
import {
  deleteProductAction,
  replaceStripeKeyAction,
  replaceWebhookSecretAction,
  updateProductAction,
} from "@/app/dashboard/products/[product]/settings/settingsActions";
import {
  connectMailAction,
  disconnectMailAction,
  sendTestEmailAction,
  setMailSwitchAction,
} from "@/app/dashboard/products/[product]/settings/emailActions";
import CommissionsPage from "@/app/dashboard/products/[product]/commissions/page";
import AffiliatesPage from "@/app/dashboard/products/[product]/affiliates/page";
import { requireAffiliate } from "@/lib/affiliateAuth";
import { dismissWelcomeAction } from "@/app/dashboard/products/[product]/dismissWelcomeAction";
import { markTrackingSeen } from "@/app/dashboard/products/[product]/markTrackingSeen";
import {
  finishOnboardingAction,
  recheckAction,
  saveStripeKeyAction,
  saveTermsAction,
  saveWebhookSecretAction,
  updateProductNameAction,
  updateProductWebsiteAction,
  updateSubdomainAction,
} from "@/app/onboarding/[product]/actions";

let hasDatabase = false;
if (process.env.DATABASE_URL) {
  try {
    await db.$connect();
    hasDatabase = true;
  } catch {
    hasDatabase = false;
  }
}

const SLUG = "acme";
const tag = crypto.randomUUID().slice(0, 8);
const PAGE = { page: 1, pageSize: 25 };
const NO_COMMISSION_FILTERS = { status: null, affiliateId: null, currency: null, query: null };

type Seeded = {
  ownerId: string;
  product: { id: string; slug: string; domain: string };
  programId: string;
  affiliateId: string;
  payableId: string;
  flaggedId: string;
  promoCodeId: string;
};

async function seed(label: string): Promise<Seeded> {
  const owner = await db.owner.create({
    data: { email: `scoping-${label}-${tag}@example.com`, passwordHash: "x" },
  });
  const merchant = await db.merchant.create({
    data: {
      ownerId: owner.id,
      // The same slug for both Owners: only the session decides which one a
      // URL resolves to.
      slug: SLUG,
      name: `Product ${label}`,
      domain: `scoping-${label}-${tag}.example.com`,
      websiteUrl: `https://scoping-${label}-${tag}.example.com`,
      stripeSecretKeyEnc: encrypt("rk_test_scoping"),
      stripeWebhookSecretEnc: encrypt("whsec_scoping"),
      stripeWebhookEndpointId: `we_${label}`,
      smtpHost: "smtp.example.com",
      smtpPort: 587,
      smtpUser: "user",
      smtpPasswordEnc: encrypt("secret"),
      mailFrom: `hello@${label}.example.com`,
      trackingVerifiedAt: new Date(),
    },
  });
  const program = await db.program.create({
    data: {
      merchantId: merchant.id,
      slug: "standard",
      name: "Standard",
      defaultCommissionRate: "20.00",
      commissionDurationType: "FOREVER",
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      merchantId: merchant.id,
      programId: program.id,
      email: `affiliate-${label}@example.com`,
      name: `Affiliate ${label}`,
      payoutDetails: `iban-${label}`,
      links: { create: { code: `scoping-${label}-${tag}`, isPrimary: true } },
    },
  });
  const click = await db.click.create({
    data: {
      affiliateId: affiliate.id,
      referralToken: `scoping-${label}-${tag}`,
      expiresAt: new Date(Date.now() + 86_400_000),
    },
  });
  const commission = (status: "PAYABLE" | "FLAGGED", ref: string) =>
    db.commission.create({
      data: {
        merchantId: merchant.id,
        affiliateId: affiliate.id,
        clickId: click.id,
        amount: "10.00",
        grossAmount: "10.00",
        currency: "usd",
        status,
        payableAt: new Date(Date.now() - 1000),
        flagReason: status === "FLAGGED" ? "self_referral" : undefined,
        stripePaymentRef: `${ref}-${label}-${tag}`,
      },
    });
  const payable = await commission("PAYABLE", "in_payable");
  const flagged = await commission("FLAGGED", "in_flagged");
  await db.referredSubscription.create({
    data: {
      merchantId: merchant.id,
      clickId: click.id,
      stripeSubscriptionId: `sub_${label}_${tag}`,
      firstPaymentRef: `in_payable-${label}-${tag}`,
      firstPaidAt: new Date(),
    },
  });
  const promo = await db.affiliatePromoCode.create({
    data: {
      merchantId: merchant.id,
      affiliateId: affiliate.id,
      stripePromotionCodeId: `promo_${label}_${tag}`,
      code: `SCOPE${label.toUpperCase()}`,
    },
  });
  return {
    ownerId: owner.id,
    product: { id: merchant.id, slug: merchant.slug, domain: merchant.domain },
    programId: program.id,
    affiliateId: affiliate.id,
    payableId: payable.id,
    flaggedId: flagged.id,
    promoCodeId: promo.id,
  };
}

/** Everything a refused write must have left alone on the first Owner's side. */
async function snapshot(s: Seeded) {
  return {
    merchant: await db.merchant.findUnique({ where: { id: s.product.id } }),
    programs: await db.program.findMany({ where: { merchantId: s.product.id }, orderBy: { id: "asc" } }),
    affiliate: await db.affiliate.findUnique({ where: { id: s.affiliateId } }),
    links: await db.affiliateLink.findMany({ where: { affiliateId: s.affiliateId }, orderBy: { id: "asc" } }),
    // fraudConfirmedAt is what a confirmed self referral stamps.
    clicks: await db.click.findMany({ where: { affiliateId: s.affiliateId }, orderBy: { id: "asc" } }),
    // Whole rows: status and dates, and every amount a payout or a refund moves.
    commissions: await db.commission.findMany({ where: { affiliateId: s.affiliateId }, orderBy: { id: "asc" } }),
    referredSubscriptions: await db.referredSubscription.findMany({
      where: { merchantId: s.product.id },
      orderBy: { id: "asc" },
    }),
    promoCodes: await db.affiliatePromoCode.findMany({ where: { merchantId: s.product.id }, orderBy: { id: "asc" } }),
    tokens: await db.affiliateLoginToken.count({ where: { affiliateId: s.affiliateId } }),
  };
}

/** The error a call ended with, a redirect included, or "" when it returned. */
async function outcome(call: () => Promise<unknown>): Promise<string> {
  try {
    await call();
    return "";
  } catch (err) {
    return (err as Error).message;
  }
}

/** The props of every element of a component in a rendered page tree. */
function propsOf(tree: unknown, component: string): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) return node.forEach(walk);
    const element = node as { type?: unknown; props?: Record<string, unknown> };
    if (typeof element.type === "function" && element.type.name === component && element.props) found.push(element.props);
    if (element.props) Object.values(element.props).forEach(walk);
  };
  walk(tree);
  return found;
}

/** Every string anywhere in a rendered page tree's props. */
function textOf(tree: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  const walk = (node: unknown) => {
    if (typeof node === "string") return void parts.push(node);
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    Object.values(node).forEach(walk);
  };
  walk(tree);
  return parts.join("\n");
}

function page(searchParams: Record<string, string>) {
  return { params: Promise.resolve({ product: SLUG }), searchParams: Promise.resolve(searchParams) };
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const PROGRAM_FORM = {
  name: "Taken over",
  defaultCommissionRate: "90",
  commissionDurationType: "FOREVER",
  commissionDurationMonths: "",
  attributionWindowDays: "60",
  holdingPeriodDays: "30",
};

async function cleanUp() {
  const owners = await db.owner.findMany({ where: { email: { endsWith: `-${tag}@example.com` } }, select: { id: true } });
  for (const owner of owners) {
    for (const merchant of await db.merchant.findMany({ where: { ownerId: owner.id }, select: { id: true } })) {
      await db.email.deleteMany({ where: { merchantId: merchant.id } });
      await deleteMerchant(owner.id, merchant.id);
    }
  }
  await db.owner.deleteMany({ where: { id: { in: owners.map((o) => o.id) } } });
}

describe.skipIf(!hasDatabase)("an Owner only reaches their own products and data", () => {
  let a: Seeded;
  let b: Seeded;
  let before: Awaited<ReturnType<typeof snapshot>>;

  beforeAll(async () => {
    a = await seed("a");
    b = await seed("b");
    before = await snapshot(a);
  });

  beforeEach(() => {
    session.user = { id: b.ownerId, role: "owner" };
    upgradeSpy.mockReset();
    moveSpy.mockReset();
    createEndpointSpy.mockReset();
  });

  afterAll(async () => {
    await cleanUp();
    await db.$disconnect();
  });

  describe("screens", () => {
    it("resolves a shared slug to the session Owner's own product, never the other one", async () => {
      expect((await getMerchantForOwnerBySlug(b.ownerId, SLUG))?.id).toBe(b.product.id);
      expect((await getMerchantForOwnerBySlug(a.ownerId, SLUG))?.id).toBe(a.product.id);
      expect(await getMerchantForOwner(b.ownerId, a.product.id)).toBeNull();
      expect((await listMerchantsForOwner(b.ownerId)).map((m) => m.id)).toEqual([b.product.id]);
    });

    it("overview and setup refuse another Owner's product", async () => {
      await expect(getProductSetup(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getOnboardingState(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getProductMetrics(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getTopAffiliates(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getWebhookHealth(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
    });

    it("affiliates screen refuses another Owner's product and their affiliate ids", async () => {
      await expect(listAffiliatesForMerchant(b.ownerId, a.product.id, { programId: null, query: null }, PAGE)).rejects.toThrow(
        "Merchant not found"
      );
      await expect(getAffiliateSignals(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getAffiliateDetails(b.ownerId, a.product.id, [a.affiliateId])).rejects.toThrow("Merchant not found");
      expect(await getAffiliateDetails(b.ownerId, b.product.id, [a.affiliateId])).toEqual({});
    });

    it("commissions and payouts screens refuse another Owner's product and filter out their ids", async () => {
      await expect(listCommissions(b.ownerId, a.product.id, NO_COMMISSION_FILTERS, PAGE)).rejects.toThrow("Merchant not found");
      await expect(getCommissionTotals(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getCommissionFilterOptions(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getOwedTotals(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(getPayableGroups(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      await expect(listPayouts(b.ownerId, a.product.id, PAGE)).rejects.toThrow("Merchant not found");
      const filtered = await listCommissions(
        b.ownerId,
        b.product.id,
        { ...NO_COMMISSION_FILTERS, affiliateId: a.affiliateId },
        PAGE
      );
      expect(filtered.total).toBe(0);
    });

    it("programs screen refuses another Owner's product", async () => {
      await expect(listProgramsForMerchant(b.ownerId, a.product.id)).rejects.toThrow("Merchant not found");
      expect(await getProgramForMerchant(b.ownerId, a.product.id, "standard")).toBeNull();
      expect(await couponsForProgramForm(b.ownerId, a.product.id)).toBeNull();
    });

    it("settings and integrations show nothing of another Owner's product", async () => {
      expect(await getIntegrationStatus(b.ownerId, a.product.id)).toEqual({ stripe: false, stripeKey: false, stripeWebhook: false });
      expect(await getStripeKeyKind(b.ownerId, a.product.id)).toBeNull();
      expect(await getStripeWebhookEndpointId(b.ownerId, a.product.id)).toBeNull();
      expect(await mailStatus(b.ownerId, a.product.id)).toBeNull();
    });

    it("never hands one Owner the checks cached for another Owner's product", async () => {
      const overrides = {
        resolvesTo: async () => ({ ok: true, detail: "a's address" }),
        httpsReachable: async () => ({ reachable: { ok: true, detail: "a" }, certificate: { ok: true, detail: "a" } }),
        stripeKeyWorks: async () => ({ ok: true, detail: "a's key" }),
        webhookEventReceived: async () => ({ ok: true, detail: "a's webhook" }),
        scriptFound: async () => ({ ok: true, detail: "a's script" }),
      };
      // Warms the cache for the product's own Owner.
      await runProductChecks(a.ownerId, a.product.id, { overrides });
      await expect(runProductChecks(b.ownerId, a.product.id, { overrides })).rejects.toThrow("Merchant not found");
      const background = await runProductChecks(b.ownerId, a.product.id, { overrides, background: true });
      expect(JSON.stringify(background)).not.toContain("a's");
    });

    it("commissions page: opens nothing for another Owner's ?commission= id, and opens one's own", async () => {
      for (const id of [a.flaggedId, a.payableId]) {
        const tree = await CommissionsPage(page({ commission: id }));
        expect(propsOf(tree, "CommissionSheet").map((p) => (p.commission as { id: string } | null)?.id ?? null)).not.toContain(id);
        expect(textOf(tree)).not.toContain(id);
      }
      const own = await CommissionsPage(page({ commission: b.flaggedId }));
      expect(propsOf(own, "CommissionSheet").map((p) => (p.commission as { id: string }).id)).toEqual([b.flaggedId]);
    });

    it("commissions page: lists nothing for another Owner's ?affiliate= filter, and lists one's own", async () => {
      const tree = await CommissionsPage(page({ affiliate: a.affiliateId }));
      expect(propsOf(tree, "CommissionTable").map((p) => p.rows)).toEqual([[]]);
      expect(textOf(tree)).not.toContain("affiliate-a@example.com");
      const own = await CommissionsPage(page({ affiliate: b.affiliateId }));
      const rows = propsOf(own, "CommissionTable")[0].rows as { id: string }[];
      expect(rows.map((r) => r.id).sort()).toEqual([b.flaggedId, b.payableId].sort());
    });

    it("affiliates page: opens nothing for another Owner's ?affiliate= id, and opens one's own", async () => {
      const tree = await AffiliatesPage(page({ affiliate: a.affiliateId }));
      expect(propsOf(tree, "AffiliateSheet").map((p) => (p.affiliate as { id: string } | null)?.id ?? null)).not.toContain(
        a.affiliateId
      );
      expect(textOf(tree)).not.toContain("affiliate-a@example.com");
      expect(textOf(tree)).not.toContain("iban-a");
      const own = await AffiliatesPage(page({ affiliate: b.affiliateId }));
      expect(propsOf(own, "AffiliateSheet").map((p) => (p.affiliate as { id: string }).id)).toEqual([b.affiliateId]);
    });
  });

  describe("affiliate sessions", () => {
    it("refuses an affiliate on another product's host, either way round", async () => {
      session.user = { id: a.affiliateId, role: "affiliate" };
      request.host = b.product.domain;
      expect(await outcome(() => requireAffiliate())).toBe("redirect:/affiliates/login");
      session.user = { id: b.affiliateId, role: "affiliate" };
      request.host = a.product.domain;
      expect(await outcome(() => requireAffiliate())).toBe("redirect:/affiliates/login");
    });

    it("lets an affiliate in on their own product's host", async () => {
      session.user = { id: a.affiliateId, role: "affiliate" };
      request.host = a.product.domain;
      expect(await requireAffiliate()).toEqual({
        affiliateId: a.affiliateId,
        email: "affiliate-a@example.com",
        merchant: expect.objectContaining({ id: a.product.id }),
      });
    });

    it("refuses an Owner session on an affiliate screen", async () => {
      request.host = a.product.domain;
      expect(await outcome(() => requireAffiliate())).toBe("redirect:/affiliates/login");
    });
  });

  describe("server actions", () => {
    it("affiliate sheet: refuses another Owner's affiliate, on their product or on one's own", async () => {
      // Their product is refused before the affiliate is looked at; on one's
      // own product their affiliate is simply not there.
      for (const [product, refusal] of [
        [a.product, "Merchant not found"],
        [b.product, "Affiliate not found"],
      ] as const) {
        expect(await outcome(() => changeProgramAction(product, a.affiliateId, form({ programId: b.programId })))).toBe(refusal);
        expect(await outcome(() => setCustomRateAction(product, a.affiliateId, form({ rate: "99" })))).toBe(refusal);
        expect(await outcome(() => setCustomRateAction(product, a.affiliateId, form({ intent: "default" })))).toBe(refusal);
        expect(await createPasswordLinkAction(product, a.affiliateId)).toEqual({ error: "Affiliate not found" });
        expect(await addPromoCodeAction(product, a.affiliateId, "ANYTHING")).toMatchObject({ error: "Affiliate not found" });
        expect(await issuePromoCodeAction(product, a.affiliateId, "ANYTHING")).toMatchObject({ error: "Affiliate not found" });
        expect(await turnOffPromoCodeAction(product, a.affiliateId, a.promoCodeId)).toMatchObject({ error: "Affiliate not found" });
      }
      // One's own affiliate with the other Owner's program is refused too.
      expect(await outcome(() => changeProgramAction(b.product, b.affiliateId, form({ programId: a.programId })))).toBe(
        "Program not found on this product"
      );
      // A code already gone answers as off, so this one is checked by the
      // snapshot below: the other Owner's code is still on.
      expect(await turnOffPromoCodeAction(b.product, b.affiliateId, a.promoCodeId)).toBeNull();
      expect(await snapshot(a)).toEqual(before);
    });

    it("commission ledger: refuses another Owner's commissions", async () => {
      const list = `/dashboard/products/${SLUG}/commissions`;
      expect(await outcome(() => confirmFraudAction(list, a.product, a.flaggedId))).toBe("Merchant not found");
      expect(await outcome(() => dismissFlagAction(list, a.product, a.flaggedId))).toBe("Merchant not found");
      expect(await outcome(() => voidAction(list, a.product, a.payableId, form({ reason: "mine now" })))).toBe("Merchant not found");
      // On one's own product their commission is simply not there.
      expect(await outcome(() => confirmFraudAction(list, b.product, a.flaggedId))).toBe(
        "Commission not found, or a refund adjustment"
      );
      expect(await outcome(() => dismissFlagAction(list, b.product, a.flaggedId))).toBe("Flagged commission not found");
      expect(await outcome(() => voidAction(list, b.product, a.payableId, form({ reason: "mine now" })))).toBe(
        "Commission not found, or already paid, voided, or a refund adjustment"
      );
      expect(
        await outcome(() => markPaidAction(list, a.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe("Merchant not found");
      // On one's own product the foreign row is not there to pay, so the
      // payout is refused as a whole.
      expect(
        await outcome(() => markPaidAction(list, b.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe(`redirect:${list}?error=refused`);
      expect(await snapshot(a)).toEqual(before);
    });

    it("payouts: refuses another Owner's payout", async () => {
      expect(
        await outcome(() => markPayoutPaidAction(a.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe("Merchant not found");
      expect(
        await outcome(() => markPayoutPaidAction(b.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe(`redirect:/dashboard/products/${SLUG}/payouts?error=refused`);
      expect(await snapshot(a)).toEqual(before);
    });

    it("programs: refuses creating or editing on another Owner's product, or editing their program", async () => {
      expect(await outcome(() => createProgramAction(a.product, { error: "" }, form(PROGRAM_FORM)))).toBe("Merchant not found");
      expect(await outcome(() => updateProgramAction(a.product, a.programId, { error: "" }, form(PROGRAM_FORM)))).toBe(
        "Merchant not found"
      );
      expect(await outcome(() => updateProgramAction(b.product, a.programId, { error: "" }, form(PROGRAM_FORM)))).toBe(
        "Program not found"
      );
      expect(await snapshot(a)).toEqual(before);
    });

    it("settings: refuses changing, re-keying or deleting another Owner's product", async () => {
      const details = form({ name: "Taken", domain: `taken-${tag}.example.com`, websiteUrl: "https://taken.example.com" });
      expect(await outcome(() => updateProductAction(a.product, { error: "" }, details))).toBe("redirect:/dashboard");
      expect(await outcome(() => replaceStripeKeyAction(a.product, { error: "" }, form({ value: "rk_test_other" })))).toBe(
        "Merchant not found"
      );
      expect(
        await outcome(() => replaceWebhookSecretAction(a.product, { error: "" }, form({ value: "whsec_other" })))
      ).toBe("Merchant not found");
      expect(await outcome(() => deleteProductAction(a.product, form({ confirm: "Product a" })))).toBe("redirect:/dashboard");
      expect(upgradeSpy).not.toHaveBeenCalled();
      expect(moveSpy).not.toHaveBeenCalled();
      expect(await snapshot(a)).toEqual(before);
    });

    it("mail settings: refuses another Owner's product", async () => {
      const mail = form({ host: "smtp.evil.example", port: "587", user: "u", password: "p", from: "x@evil.example" });
      expect(await connectMailAction(a.product, { error: "", sentTo: "" }, mail)).toEqual({ error: "Product not found", sentTo: "" });
      expect(await sendTestEmailAction(a.product)).toEqual({ error: "Email is off", sentTo: "" });
      // Both answer nothing either way, so the snapshot is the check.
      await expect(disconnectMailAction(a.product)).resolves.toBeUndefined();
      await expect(setMailSwitchAction(a.product, "notifyNewSales", false)).resolves.toBeUndefined();
      expect(await snapshot(a)).toEqual(before);
    });

    it("overview: refuses dismissing the welcome or the tracking moment on another Owner's product", async () => {
      expect(await outcome(() => dismissWelcomeAction(a.product))).toBe("Merchant not found");
      await expect(markTrackingSeen(a.product.id)).resolves.toBeUndefined();
      expect(await snapshot(a)).toEqual(before);
    });

    it("onboarding: refuses every step on another Owner's product", async () => {
      const value = (v: string) => form({ value: v });
      expect(await outcome(() => updateSubdomainAction(a.product, { error: "" }, value("taken")))).toBe("redirect:/onboarding");
      expect(await outcome(() => updateProductNameAction(a.product, { error: "" }, value("Taken")))).toBe("redirect:/onboarding");
      expect(
        await outcome(() => updateProductWebsiteAction(a.product, { error: "" }, value("https://taken.example.com")))
      ).toBe("redirect:/onboarding");
      expect(await outcome(() => saveStripeKeyAction(a.product, { error: "" }, value("rk_test_other")))).toBe(
        "redirect:/onboarding"
      );
      expect(await outcome(() => saveWebhookSecretAction(a.product, { error: "" }, value("whsec_other")))).toBe(
        "Merchant not found"
      );
      expect(await outcome(() => saveTermsAction(a.product, { error: "" }, form(PROGRAM_FORM)))).toBe("redirect:/onboarding");
      expect(await outcome(() => recheckAction(a.product, "stripe-key"))).toBe("redirect:/onboarding");
      expect(await outcome(() => finishOnboardingAction(a.product))).toBe("Merchant not found");
      expect(createEndpointSpy).not.toHaveBeenCalled();
      expect(await snapshot(a)).toEqual(before);
    });

    it("refuses an affiliate session on every Owner action", async () => {
      session.user = { id: a.affiliateId, role: "affiliate" };
      expect(await outcome(() => setCustomRateAction(a.product, a.affiliateId, form({ rate: "99" })))).toBe("redirect:/login");
      expect(await outcome(() => dismissWelcomeAction(a.product))).toBe("redirect:/login");
      expect(await outcome(() => saveWebhookSecretAction(a.product, { error: "" }, form({ value: "whsec_x" })))).toBe(
        "redirect:/login"
      );
      expect(await snapshot(a)).toEqual(before);
    });
  });

  // Last, since these change the first Owner's rows the snapshots above hold.
  describe("the product's own Owner makes the same writes", () => {
    const list = `/dashboard/products/${SLUG}/commissions`;

    beforeEach(() => {
      session.user = { id: a.ownerId, role: "owner" };
    });

    it("affiliate sheet", async () => {
      await setCustomRateAction(a.product, a.affiliateId, form({ rate: "25" }));
      expect((await db.affiliate.findUnique({ where: { id: a.affiliateId } }))?.customCommissionRate?.toString()).toBe("25");
      expect(await createPasswordLinkAction(a.product, a.affiliateId)).toEqual({ token: expect.any(String) });
    });

    it("commission ledger", async () => {
      expect(await outcome(() => dismissFlagAction(list, a.product, a.flaggedId))).toBe(`redirect:${list}`);
      expect((await db.commission.findUniqueOrThrow({ where: { id: a.flaggedId } })).status).not.toBe("FLAGGED");
    });

    it("payouts", async () => {
      expect(
        await outcome(() => markPayoutPaidAction(a.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe(`redirect:/dashboard/products/${SLUG}/payouts`);
      expect((await db.commission.findUniqueOrThrow({ where: { id: a.payableId } })).status).toBe("PAID");
    });

    it("programs", async () => {
      const programs = `redirect:/dashboard/products/${SLUG}/programs`;
      expect(await outcome(() => updateProgramAction(a.product, a.programId, { error: "" }, form(PROGRAM_FORM)))).toBe(programs);
      expect((await db.program.findUniqueOrThrow({ where: { id: a.programId } })).name).toBe("Taken over");
      expect(await outcome(() => createProgramAction(a.product, { error: "" }, form({ ...PROGRAM_FORM, name: "Second" })))).toBe(
        programs
      );
      expect(await db.program.count({ where: { merchantId: a.product.id } })).toBe(2);
    });

    it("settings", async () => {
      expect(await outcome(() => replaceWebhookSecretAction(a.product, { error: "" }, form({ value: "whsec_other" })))).toBe(
        `redirect:/dashboard/products/${SLUG}/settings?fresh=stripe`
      );
      const merchant = await db.merchant.findUniqueOrThrow({ where: { id: a.product.id } });
      expect(merchant.stripeWebhookSecretEnc).not.toBe(before.merchant?.stripeWebhookSecretEnc);
    });

    it("mail settings", async () => {
      await setMailSwitchAction(a.product, "notifyNewSales", false);
      expect((await db.merchant.findUniqueOrThrow({ where: { id: a.product.id } })).notifyNewSales).toBe(false);
    });

    it("overview", async () => {
      await dismissWelcomeAction(a.product);
      await markTrackingSeen(a.product.id);
      const merchant = await db.merchant.findUniqueOrThrow({ where: { id: a.product.id } });
      expect(merchant.welcomeDismissedAt).not.toBeNull();
      expect(merchant.trackingVerifiedSeenAt).not.toBeNull();
    });

    it("onboarding", async () => {
      expect(await updateProductNameAction(a.product, { error: "" }, form({ value: "Renamed" }))).toMatchObject({ error: "" });
      expect((await db.merchant.findUniqueOrThrow({ where: { id: a.product.id } })).name).toBe("Renamed");
    });
  });
});
