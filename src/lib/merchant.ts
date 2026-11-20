import type { PaymentProvider } from "@prisma/client";
import { db } from "@/lib/db";
import { assertOwnsMerchant } from "@/lib/ownership";
import { encrypt, decrypt } from "@/lib/crypto";
import { uniqueSlug } from "@/lib/slug";
import { claimDomain, ownershipProofRequired, releaseDomain, servedDomain } from "@/lib/domainOwnership";

// Creating a Merchant takes no credentials. Connecting the payment provider
// is a separate step, done against a Merchant that already exists, so the
// Owner is never asked for a key before they have been told what Supaffi does
// with it.
type MerchantDetailsInput = {
  name: string;
  domain: string;
  websiteUrl: string;
};

export async function createMerchant(
  ownerId: string,
  input: MerchantDetailsInput & { paymentProvider?: PaymentProvider }
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug(input.name, "product", async (candidate) =>
    Boolean(
      await db.merchant.findFirst({
        where: { ownerId, slug: candidate },
        select: { id: true },
      })
    )
  );

  return db.$transaction(async (tx) => {
    // Throws DomainClaimError when the domain cannot be taken.
    const claim = await claimDomain(tx, ownerId, input.domain);
    return tx.merchant.create({
      data: {
        ownerId,
        name: input.name,
        slug,
        domain: input.domain,
        ...claim,
        websiteUrl: input.websiteUrl,
        ...(input.paymentProvider ? { paymentProvider: input.paymentProvider } : {}),
      },
      select: { id: true, slug: true },
    });
  });
}

// Fields are individually optional so re-connecting can rotate one secret
// without the caller having to re-send the other. An empty string is treated
// as "not provided", never encrypted over the top of a live credential.
export async function connectPaymentProvider(
  ownerId: string,
  merchantId: string,
  input: { secretKey?: string; webhookSecret?: string; webhookEndpointId?: string | null; sandbox?: boolean }
): Promise<void> {
  await assertOwnsMerchant(ownerId, merchantId);
  await db.merchant.update({
    where: { id: merchantId },
    data: {
      ...(input.secretKey ? { paymentKeyEnc: encrypt(input.secretKey) } : {}),
      ...(input.webhookSecret ? { webhookSecretEnc: encrypt(input.webhookSecret) } : {}),
      // Explicit null clears it, which is what a manually pasted secret means:
      // the endpoint on the other end is one Supaffi did not create and must
      // not later delete.
      ...(input.webhookEndpointId !== undefined ? { webhookEndpointId: input.webhookEndpointId } : {}),
      ...(input.sandbox !== undefined ? { paymentSandbox: input.sandbox } : {}),
    },
  });
}

// Which integrations are live, without ever handing the ciphertext to a
// caller that only needs to render a checkmark.
//
// The two halves of the payment connection are reported separately as well
// as together. A
// screen that treats "key and secret" as one thing cannot tell someone who
// has pasted the key and still owes the webhook secret where they are, and
// onboarding has a step for each.
export async function getIntegrationStatus(
  ownerId: string,
  merchantId: string
): Promise<{ connected: boolean; key: boolean; webhook: boolean }> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { paymentKeyEnc: true, webhookSecretEnc: true },
  });
  const key = Boolean(merchant?.paymentKeyEnc);
  const webhook = Boolean(merchant?.webhookSecretEnc);
  return { connected: key && webhook, key, webhook };
}

export type StripeKeyKind = "restricted" | "secret" | null;

/**
 * What kind of Stripe key is on file, told apart by its prefix alone.
 *
 * `rk_` is what the pre-filled restricted-key link (stripeRestrictedKey.ts)
 * produces; `sk_` is a full account key pasted in some other way, which can
 * do far more than Supaffi needs and is worth the Owner's status screen
 * flagging. Decrypting is cheap (one AES block), and the plaintext never
 * leaves this function.
 */
export async function getStripeKeyKind(
  ownerId: string,
  merchantId: string
): Promise<StripeKeyKind> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { paymentKeyEnc: true },
  });
  if (!merchant?.paymentKeyEnc) return null;

  // A rotated or lost MASTER_ENCRYPTION_KEY makes decrypt throw. Integrations
  // is the one screen that exists to tell an Owner their Stripe connection is
  // broken, so it has to render and say so rather than 500 (CONTEXT.md: a
  // decrypt failure prompts a reconnect).
  let key: string;
  try {
    key = decrypt(merchant.paymentKeyEnc);
  } catch {
    return null;
  }
  if (key.startsWith("rk_")) return "restricted";
  if (key.startsWith("sk_")) return "secret";
  return null;
}

export async function listMerchantsForOwner(
  ownerId: string
): Promise<
  { id: string; slug: string; name: string; domain: string; onboardingCompletedAt: Date | null }[]
> {
  const merchants = await db.merchant.findMany({
    where: { ownerId },
    // onboardingCompletedAt so the product list can tell a product still being
    // set up from one that is running, without a second query per row.
    select: { id: true, slug: true, name: true, domain: true, onboardingCompletedAt: true },
    orderBy: { createdAt: "asc" },
  });
  return merchants.map(withDomain);
}

/**
 * A product's domain for the screens, empty when it has none. A product loses
 * its domain only when another Owner claims it before this one proved it
 * (see claimDomain), and its Owner then sets a new one.
 */
function withDomain<T extends { domain: string | null }>(merchant: T): T & { domain: string } {
  return { ...merchant, domain: merchant.domain ?? "" };
}

/**
 * What a route hands to a Server Action: the id it acts on and the slug it
 * redirects back to. Both, because an action that only knew the slug would
 * have to re-resolve it, and one that only knew the id could not build the URL
 * the Owner should land on.
 */
export type ProductRef = { id: string; slug: string };

export type OwnedMerchant = {
  id: string;
  slug: string;
  name: string;
  domain: string;
  websiteUrl: string;
  paymentProvider: PaymentProvider;
  paymentSandbox: boolean;
  createdAt: Date;
};

/**
 * The endpoint Supaffi created, or null when there is none. Kept off
 * OwnedMerchant on purpose: that shape is the product's own details, read by
 * every dashboard route, and one Stripe implementation detail does not belong
 * in all of them.
 */
export async function getWebhookEndpointId(
  ownerId: string,
  merchantId: string
): Promise<string | null> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { webhookEndpointId: true },
  });
  return merchant?.webhookEndpointId ?? null;
}

export async function getMerchantForOwner(
  ownerId: string,
  merchantId: string
): Promise<OwnedMerchant | null> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: MERCHANT_FIELDS,
  });
  return merchant && withDomain(merchant);
}

// What every dashboard route under /dashboard/products/[product] resolves
// with. The URL carries the slug; everything below this call uses `.id`.
export async function getMerchantForOwnerBySlug(
  ownerId: string,
  slug: string
): Promise<OwnedMerchant | null> {
  const merchant = await db.merchant.findFirst({
    where: { slug, ownerId },
    select: MERCHANT_FIELDS,
  });
  return merchant && withDomain(merchant);
}

const MERCHANT_FIELDS = {
  id: true,
  slug: true,
  name: true,
  domain: true,
  websiteUrl: true,
  paymentProvider: true,
  paymentSandbox: true,
  createdAt: true,
} as const;

/**
 * Saves a product's details. Answers whether its domain is served now: a new
 * domain waiting for proof is not, and the proven one it replaces keeps being
 * served, and keeps its payment webhook, until the new one is proven.
 */
export async function updateMerchant(
  ownerId: string,
  merchantId: string,
  input: MerchantDetailsInput
): Promise<{ live: boolean }> {
  await assertOwnsMerchant(ownerId, merchantId);
  return db.$transaction(async (tx) => {
    const before = await tx.merchant.findUniqueOrThrow({
      where: { id: merchantId },
      select: { domain: true, domainVerifiedAt: true, previousDomain: true },
    });
    const details = { name: input.name, websiteUrl: input.websiteUrl };
    if (input.domain === before.domain) {
      await tx.merchant.update({ where: { id: merchantId }, data: details });
      return { live: before.domainVerifiedAt !== null };
    }
    // Back to the proven domain still being served: nothing to prove.
    if (ownershipProofRequired() && input.domain === before.previousDomain) {
      await tx.merchant.update({
        where: { id: merchantId },
        data: { ...details, domain: input.domain, previousDomain: null, domainToken: null, domainVerifiedAt: new Date() },
      });
      return { live: true };
    }

    // A new domain is a new claim, proven afresh. Throws DomainClaimError when
    // it cannot be taken, before anything is written.
    const claim = await claimDomain(tx, ownerId, input.domain, merchantId);
    const live = claim.domainVerifiedAt !== null;
    const served = before.domainVerifiedAt ? before.domain : before.previousDomain;
    const previousDomain = live ? null : served;
    await tx.merchant.update({
      where: { id: merchantId },
      data: { ...details, domain: input.domain, ...claim, previousDomain },
    });
    // The proven domain stops being served only once the new one is live.
    if (served && live) await releaseDomain(tx, ownerId, served);
    return { live };
  });
}

export async function getMerchantByDomain(
  domain: string
): Promise<{ id: string; slug: string; name: string; domain: string; websiteUrl: string } | null> {
  const merchant = await db.merchant.findFirst({
    where: servedDomain(domain),
    select: { id: true, slug: true, name: true, domain: true, websiteUrl: true },
  });
  return merchant && { ...merchant, domain };
}

/**
 * Deletes a product and every row that hangs off it, in one transaction, in
 * dependency order. Prisma relations here have no cascade, and adding one to
 * the schema would make an accidental delete of a Merchant row silently take
 * a year of commission history with it. Explicit here, behind the ownership
 * check, is the only place that should be able to do this.
 */
export async function deleteMerchant(ownerId: string, merchantId: string): Promise<void> {
  await assertOwnsMerchant(ownerId, merchantId);
  const affiliates = { affiliate: { merchantId } };
  // An import writing into it meanwhile would leave rows behind the delete.
  const importing = await db.import.findFirst({
    where: { merchantId, status: { in: ["FETCHING", "IMPORTING"] } },
    select: { id: true },
  });
  if (importing) throw new Error("An import is running on this product. Delete it once the import is done.");
  await db.$transaction(
    async (tx) => {
      const { domain, domainVerifiedAt, previousDomain } = await tx.merchant.findUniqueOrThrow({
        where: { id: merchantId },
        select: { domain: true, domainVerifiedAt: true, previousDomain: true },
      });
      await tx.commission.deleteMany({ where: affiliates });
      await tx.payout.deleteMany({ where: { merchantId } });
      // Points at the click, so it goes before clicks do.
      await tx.referredSubscription.deleteMany({ where: { merchantId } });
      await tx.click.deleteMany({ where: affiliates });
      await tx.affiliatePromoCode.deleteMany({ where: { merchantId } });
      await tx.affiliateLink.deleteMany({ where: affiliates });
      await tx.affiliateLoginToken.deleteMany({ where: affiliates });
      await tx.affiliate.deleteMany({ where: { merchantId } });
      await tx.program.deleteMany({ where: { merchantId } });
      await tx.webhookEvent.deleteMany({ where: { merchantId } });
      await tx.import.deleteMany({ where: { merchantId } });
      await tx.merchant.delete({ where: { id: merchantId } });
      // Whichever proven domain it was serving is held for its Owner.
      const served = domainVerifiedAt ? domain : previousDomain;
      if (served) await releaseDomain(tx, ownerId, served);
    },
    // A year of history can take longer than the five second default.
    { timeout: 60_000 }
  );
}

export async function getOnboardingState(
  ownerId: string,
  merchantId: string
): Promise<{ onboardingCompletedAt: Date | null; welcomeDismissedAt: Date | null }> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { onboardingCompletedAt: true, welcomeDismissedAt: true },
  });
  if (!merchant) throw new Error("Merchant not found");
  return merchant;
}

// Set once. Re-running onboarding to reconnect something must not make the
// product look freshly finished again.
export async function markOnboardingComplete(ownerId: string, merchantId: string): Promise<void> {
  await assertOwnsMerchant(ownerId, merchantId);
  await db.merchant.updateMany({
    where: { id: merchantId, onboardingCompletedAt: null },
    data: { onboardingCompletedAt: new Date() },
  });
}

export async function dismissWelcome(ownerId: string, merchantId: string): Promise<void> {
  await assertOwnsMerchant(ownerId, merchantId);
  await db.merchant.updateMany({
    where: { id: merchantId, welcomeDismissedAt: null },
    data: { welcomeDismissedAt: new Date() },
  });
}

