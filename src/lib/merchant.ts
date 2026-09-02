import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { uniqueSlug } from "@/lib/slug";

// Creating a Merchant no longer takes any credentials. Connecting Stripe
// and email delivery are separate steps, done against a Merchant that
// already exists, so the Owner is never asked for a Stripe secret before
// they have been told what Supaffi does with it.
type MerchantDetailsInput = {
  name: string;
  domain: string;
  websiteUrl: string;
};

export async function createMerchant(
  ownerId: string,
  input: MerchantDetailsInput
): Promise<{ id: string; slug: string }> {
  const slug = await uniqueSlug(input.name, "product", async (candidate) =>
    Boolean(
      await db.merchant.findFirst({
        where: { ownerId, slug: candidate },
        select: { id: true },
      })
    )
  );

  return db.merchant.create({
    data: {
      ownerId,
      name: input.name,
      slug,
      domain: input.domain,
      websiteUrl: input.websiteUrl,
    },
    select: { id: true, slug: true },
  });
}

// Ownership check shared by every mutation below. findFirst scoped by both
// id and ownerId, not a bare findUnique(id) — this is what actually enforces
// ownership; an update scoped only by id would happily write to another
// Owner's Merchant.
async function assertOwns(ownerId: string, merchantId: string): Promise<void> {
  const existing = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Merchant not found");
  }
}

// Fields are individually optional so re-connecting can rotate one secret
// without the caller having to re-send the other. An empty string is treated
// as "not provided", never encrypted over the top of a live credential.
export async function connectStripe(
  ownerId: string,
  merchantId: string,
  input: { secretKey?: string; webhookSecret?: string }
): Promise<void> {
  await assertOwns(ownerId, merchantId);
  await db.merchant.update({
    where: { id: merchantId },
    data: {
      ...(input.secretKey ? { stripeSecretKeyEnc: encrypt(input.secretKey) } : {}),
      ...(input.webhookSecret ? { stripeWebhookSecretEnc: encrypt(input.webhookSecret) } : {}),
    },
  });
}

export async function connectEmailProvider(
  ownerId: string,
  merchantId: string,
  apiKey: string
): Promise<void> {
  await assertOwns(ownerId, merchantId);
  await db.merchant.update({
    where: { id: merchantId },
    data: { emailProviderConfigEnc: encrypt(apiKey) },
  });
}

// Which integrations are live, without ever handing the ciphertext to a
// caller that only needs to render a checkmark.
export async function getIntegrationStatus(
  ownerId: string,
  merchantId: string
): Promise<{ stripe: boolean; email: boolean }> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { stripeSecretKeyEnc: true, stripeWebhookSecretEnc: true, emailProviderConfigEnc: true },
  });
  return {
    stripe: Boolean(merchant?.stripeSecretKeyEnc && merchant?.stripeWebhookSecretEnc),
    email: Boolean(merchant?.emailProviderConfigEnc),
  };
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
    select: { stripeSecretKeyEnc: true },
  });
  if (!merchant?.stripeSecretKeyEnc) return null;

  const key = decrypt(merchant.stripeSecretKeyEnc);
  if (key.startsWith("rk_")) return "restricted";
  if (key.startsWith("sk_")) return "secret";
  return null;
}

export async function listMerchantsForOwner(
  ownerId: string
): Promise<{ id: string; slug: string; name: string; domain: string }[]> {
  return db.merchant.findMany({
    where: { ownerId },
    select: { id: true, slug: true, name: true, domain: true },
    orderBy: { createdAt: "asc" },
  });
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
  createdAt: Date;
};

export async function getMerchantForOwner(
  ownerId: string,
  merchantId: string
): Promise<OwnedMerchant | null> {
  return db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: MERCHANT_FIELDS,
  });
}

// What every dashboard route under /dashboard/products/[product] resolves
// with. The URL carries the slug; everything below this call uses `.id`.
export async function getMerchantForOwnerBySlug(
  ownerId: string,
  slug: string
): Promise<OwnedMerchant | null> {
  return db.merchant.findFirst({
    where: { slug, ownerId },
    select: MERCHANT_FIELDS,
  });
}

const MERCHANT_FIELDS = {
  id: true,
  slug: true,
  name: true,
  domain: true,
  websiteUrl: true,
  createdAt: true,
} as const;

export async function updateMerchant(
  ownerId: string,
  merchantId: string,
  input: MerchantDetailsInput
): Promise<void> {
  await assertOwns(ownerId, merchantId);
  await db.merchant.update({
    where: { id: merchantId },
    data: {
      name: input.name,
      domain: input.domain,
      websiteUrl: input.websiteUrl,
    },
  });
}

export async function getMerchantByDomain(
  domain: string
): Promise<{ id: string; slug: string; name: string; domain: string; websiteUrl: string } | null> {
  return db.merchant.findUnique({
    where: { domain },
    select: { id: true, slug: true, name: true, domain: true, websiteUrl: true },
  });
}

// Internal only — the one function that returns the encrypted email
// credential. Never call this from a page or anything whose result reaches
// a response; only the Affiliate magic-link send path (src/lib/email/
// affiliateMagicLink.ts) needs it.
export async function getMerchantEmailCredentials(
  merchantId: string
): Promise<{ name: string; domain: string; emailProviderConfigEnc: string | null } | null> {
  return db.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, domain: true, emailProviderConfigEnc: true },
  });
}
