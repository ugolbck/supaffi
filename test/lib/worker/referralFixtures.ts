// Seeding shared by the suites that exercise referred subscriptions. Every
// helper writes to the scratch DATABASE_URL that test/setup.ts enforces.
import type { CommissionDurationType, Merchant } from "@prisma/client";
import type Stripe from "stripe";
import { db } from "@/lib/db";

const DAY = 24 * 60 * 60 * 1000;

/** Clears in foreign key order: adjustments, commissions, referred subscriptions, clicks. */
export async function clearReferralTables(): Promise<void> {
  await db.commission.deleteMany({ where: { adjustsCommissionId: { not: null } } });
  await db.commission.deleteMany();
  await db.referredSubscription.deleteMany();
  await db.click.deleteMany();
  await db.affiliateLink.deleteMany();
  await db.affiliate.deleteMany();
  await db.program.deleteMany();
  await db.merchant.deleteMany();
  await db.owner.deleteMany();
}

export async function seedOwner() {
  return db.owner.create({
    data: { email: `owner-${crypto.randomUUID()}@example.com`, passwordHash: "x" },
  });
}

export async function seedMerchant(ownerId: string): Promise<Merchant> {
  return db.merchant.create({
    data: {
      slug: crypto.randomUUID(),
      ownerId,
      name: "Product",
      domain: `${crypto.randomUUID()}.example.com`,
      websiteUrl: "https://product.example.com",
      stripeSecretKeyEnc: "x",
    },
  });
}

export async function seedReferral(
  merchant: Merchant,
  opts: {
    durationType?: CommissionDurationType;
    months?: number | null;
    affiliateEmail?: string;
    clickCreatedAt?: Date;
  } = {}
) {
  const program = await db.program.create({
    data: {
      slug: crypto.randomUUID(),
      merchantId: merchant.id,
      name: "Standard",
      defaultCommissionRate: 20,
      commissionDurationType: opts.durationType ?? "FOREVER",
      commissionDurationMonths: opts.months ?? null,
      attributionWindowDays: 60,
      holdingPeriodDays: 30,
    },
  });
  const affiliate = await db.affiliate.create({
    data: {
      merchantId: merchant.id,
      programId: program.id,
      email: opts.affiliateEmail ?? `aff-${crypto.randomUUID()}@example.com`,
      links: { create: { code: crypto.randomUUID(), isPrimary: true } },
    },
  });
  const createdAt = opts.clickCreatedAt ?? new Date(Date.now() - DAY);
  const click = await db.click.create({
    data: {
      affiliateId: affiliate.id,
      referralToken: crypto.randomUUID(),
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 60 * DAY),
    },
  });
  return { program, affiliate, click };
}

export async function seedReferredSubscription(
  merchantId: string,
  clickId: string,
  stripeSubscriptionId: string,
  firstPayment?: { ref: string; at: Date },
  stripeProductIds?: string[]
) {
  return db.referredSubscription.create({
    data: {
      merchantId,
      clickId,
      stripeSubscriptionId,
      firstPaymentRef: firstPayment?.ref ?? null,
      firstPaidAt: firstPayment?.at ?? null,
      // Left to the column default when a case does not care, which is how
      // rows recorded before 0.2.7 look.
      ...(stripeProductIds ? { stripeProductIds } : {}),
    },
  });
}

/** Makes a click look linked by customer, the way checkout did before 0.2.5. */
export async function seedLegacyClick(clickId: string, stripeCustomerId: string) {
  return db.click.update({ where: { id: clickId }, data: { stripeCustomerId } });
}

/** A commission earned on an invoice, as the old handlers wrote them. */
export async function seedInvoiceCommission(
  affiliateId: string,
  clickId: string,
  ref: string,
  createdAt: Date = new Date()
) {
  return db.commission.create({
    data: {
      affiliateId,
      clickId,
      stripePaymentRef: ref,
      amount: 10,
      grossAmount: 10,
      currency: "usd",
      status: "PAID",
      payableAt: createdAt,
      createdAt,
    },
  });
}

/** An invoice as `stripe.invoices.retrieve` returns it, with only the fields recognition reads. */
export function retrievedInvoice(
  id: string,
  subscription: string,
  opts: { billingReason?: Stripe.Invoice.BillingReason; amountPaid?: number; created?: Date } = {}
) {
  return {
    id,
    billing_reason: opts.billingReason ?? "subscription_create",
    amount_paid: opts.amountPaid ?? 5000,
    created: Math.floor((opts.created ?? new Date()).getTime() / 1000),
    parent: { type: "subscription_details", subscription_details: { subscription, metadata: {} } },
  };
}

/** A thrown Stripe SDK error, carrying the `type` and `code` the SDK sets. */
export function stripeError(type: string, code?: string): Error {
  return Object.assign(new Error(type), { type, code });
}
