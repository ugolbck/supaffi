// An Owner only reaches their own products and data. Two Owners, each with a
// product under the same slug; the session is the second Owner throughout,
// and every screen's reads and every Server Action are pointed at the first
// Owner's product, or at the second Owner's own product with the first
// Owner's nested ids (affiliate, commission, program, promo code). Each one
// has to refuse or come back empty, and the first Owner's rows must not move.
//
// Destructive on its own rows only. Runs against the scratch DATABASE_URL.
import { describe, it, expect, vi, beforeAll, beforeEach, afterAll } from "vitest";

process.env.MASTER_ENCRYPTION_KEY ??= "0".repeat(64);

const session = { user: { id: "", role: "owner" as "owner" | "affiliate" } };
vi.mock("@/lib/auth", () => ({ auth: async () => session }));
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
  product: { id: string; slug: string };
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
    product: { id: merchant.id, slug: merchant.slug },
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
    commissions: await db.commission.findMany({
      where: { affiliateId: s.affiliateId },
      orderBy: { id: "asc" },
      select: { id: true, status: true, paidAt: true, voidedAt: true, flagReason: true },
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
      await expect(listAffiliatesForMerchant(b.ownerId, a.product.id, { programId: null, query: null }, PAGE)).rejects.toThrow();
      await expect(getAffiliateSignals(b.ownerId, a.product.id)).rejects.toThrow();
      await expect(getAffiliateDetails(b.ownerId, a.product.id, [a.affiliateId])).rejects.toThrow();
      expect(await getAffiliateDetails(b.ownerId, b.product.id, [a.affiliateId])).toEqual({});
    });

    it("commissions and payouts screens refuse another Owner's product and filter out their ids", async () => {
      await expect(listCommissions(b.ownerId, a.product.id, NO_COMMISSION_FILTERS, PAGE)).rejects.toThrow();
      await expect(getCommissionTotals(b.ownerId, a.product.id)).rejects.toThrow();
      await expect(getCommissionFilterOptions(b.ownerId, a.product.id)).rejects.toThrow();
      await expect(getOwedTotals(b.ownerId, a.product.id)).rejects.toThrow();
      await expect(getPayableGroups(b.ownerId, a.product.id)).rejects.toThrow();
      await expect(listPayouts(b.ownerId, a.product.id, PAGE)).rejects.toThrow();
      const filtered = await listCommissions(
        b.ownerId,
        b.product.id,
        { ...NO_COMMISSION_FILTERS, affiliateId: a.affiliateId },
        PAGE
      );
      expect(filtered.total).toBe(0);
    });

    it("programs screen refuses another Owner's product", async () => {
      await expect(listProgramsForMerchant(b.ownerId, a.product.id)).rejects.toThrow();
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
  });

  describe("server actions", () => {
    it("affiliate sheet: refuses another Owner's affiliate, on their product or on one's own", async () => {
      for (const product of [a.product, b.product]) {
        expect(await outcome(() => changeProgramAction(product, a.affiliateId, form({ programId: b.programId })))).not.toBe("");
        expect(await outcome(() => setCustomRateAction(product, a.affiliateId, form({ rate: "99" })))).not.toBe("");
        expect(await outcome(() => setCustomRateAction(product, a.affiliateId, form({ intent: "default" })))).not.toBe("");
        expect(await createPasswordLinkAction(product, a.affiliateId)).toEqual({ error: "Affiliate not found" });
        expect(await addPromoCodeAction(product, a.affiliateId, "ANYTHING")).toMatchObject({ error: "Affiliate not found" });
        expect(await issuePromoCodeAction(product, a.affiliateId, "ANYTHING")).toMatchObject({ error: "Affiliate not found" });
        expect(await turnOffPromoCodeAction(product, a.affiliateId, a.promoCodeId)).toMatchObject({ error: expect.any(String) });
      }
      // One's own affiliate with the other Owner's program is refused too.
      expect(await outcome(() => changeProgramAction(b.product, b.affiliateId, form({ programId: a.programId })))).not.toBe("");
      // A code already gone answers as off, so this one is checked by the
      // snapshot below: the other Owner's code is still on.
      await turnOffPromoCodeAction(b.product, b.affiliateId, a.promoCodeId);
      expect(await snapshot(a)).toEqual(before);
    });

    it("commission ledger: refuses another Owner's commissions", async () => {
      const list = `/dashboard/products/${SLUG}/commissions`;
      for (const product of [a.product, b.product]) {
        expect(await outcome(() => confirmFraudAction(list, product, a.flaggedId))).not.toMatch(/^redirect:/);
        expect(await outcome(() => dismissFlagAction(list, product, a.flaggedId))).not.toMatch(/^redirect:/);
        expect(await outcome(() => voidAction(list, product, a.payableId, form({ reason: "mine now" })))).not.toMatch(/^redirect:/);
      }
      expect(
        await outcome(() => markPaidAction(list, a.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe("Merchant not found");
      // On one's own product the foreign row is simply not there to pay.
      await outcome(() => markPaidAction(list, b.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()));
      expect(await snapshot(a)).toEqual(before);
    });

    it("payouts: refuses another Owner's payout", async () => {
      expect(
        await outcome(() => markPayoutPaidAction(a.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()))
      ).toBe("Merchant not found");
      await outcome(() => markPayoutPaidAction(b.product, [{ id: a.payableId, amount: "10.00" }], new Date().toISOString()));
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
      await disconnectMailAction(a.product);
      await setMailSwitchAction(a.product, "notifyNewSales", false);
      expect(await snapshot(a)).toEqual(before);
    });

    it("overview: refuses dismissing the welcome or the tracking moment on another Owner's product", async () => {
      expect(await outcome(() => dismissWelcomeAction(a.product))).toBe("Merchant not found");
      await markTrackingSeen(a.product.id);
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

    it("lets the product's own Owner make the same write, so the refusals above are about ownership", async () => {
      session.user = { id: a.ownerId, role: "owner" };
      await setCustomRateAction(a.product, a.affiliateId, form({ rate: "25" }));
      expect((await db.affiliate.findUnique({ where: { id: a.affiliateId } }))?.customCommissionRate?.toString()).toBe("25");
      await setCustomRateAction(a.product, a.affiliateId, form({ intent: "default" }));
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
});
