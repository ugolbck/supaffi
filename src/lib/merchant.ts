import { db } from "@/lib/db";
import { encrypt } from "@/lib/crypto";

type CreateMerchantInput = {
  name: string;
  domain: string;
  websiteUrl: string;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  emailProviderConfig: string;
};

type UpdateMerchantInput = {
  name: string;
  domain: string;
  websiteUrl: string;
  stripeSecretKey?: string;
  stripeWebhookSecret?: string;
  emailProviderConfig?: string;
};

export async function createMerchant(
  ownerId: string,
  input: CreateMerchantInput
): Promise<{ id: string }> {
  return db.merchant.create({
    data: {
      ownerId,
      name: input.name,
      domain: input.domain,
      websiteUrl: input.websiteUrl,
      stripeSecretKeyEnc: encrypt(input.stripeSecretKey),
      stripeWebhookSecretEnc: encrypt(input.stripeWebhookSecret),
      emailProviderConfigEnc: encrypt(input.emailProviderConfig),
    },
    select: { id: true },
  });
}

export async function listMerchantsForOwner(
  ownerId: string
): Promise<{ id: string; name: string; domain: string }[]> {
  return db.merchant.findMany({
    where: { ownerId },
    select: { id: true, name: true, domain: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getMerchantForOwner(
  ownerId: string,
  merchantId: string
): Promise<{ id: string; name: string; domain: string; websiteUrl: string; createdAt: Date } | null> {
  return db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true, name: true, domain: true, websiteUrl: true, createdAt: true },
  });
}

export async function updateMerchant(
  ownerId: string,
  merchantId: string,
  input: UpdateMerchantInput
): Promise<void> {
  // findFirst scoped by both id and ownerId, not a bare findUnique(id) —
  // this is what actually enforces the ownership check; updateMany below
  // would otherwise silently affect zero rows for a mismatched owner
  // without ever telling the caller why.
  const existing = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Merchant not found");
  }

  await db.merchant.update({
    where: { id: merchantId },
    data: {
      name: input.name,
      domain: input.domain,
      websiteUrl: input.websiteUrl,
      ...(input.stripeSecretKey !== undefined && {
        stripeSecretKeyEnc: encrypt(input.stripeSecretKey),
      }),
      ...(input.stripeWebhookSecret !== undefined && {
        stripeWebhookSecretEnc: encrypt(input.stripeWebhookSecret),
      }),
      ...(input.emailProviderConfig !== undefined && {
        emailProviderConfigEnc: encrypt(input.emailProviderConfig),
      }),
    },
  });
}

export async function getMerchantByDomain(
  domain: string
): Promise<{ id: string; name: string; domain: string; websiteUrl: string } | null> {
  return db.merchant.findUnique({
    where: { domain },
    select: { id: true, name: true, domain: true, websiteUrl: true },
  });
}

// Internal only — the one function that returns the encrypted email
// credential. Never call this from a page or anything whose result reaches
// a response; only the Affiliate magic-link send path (src/lib/email/
// affiliateMagicLink.ts) needs it.
export async function getMerchantEmailCredentials(
  merchantId: string
): Promise<{ name: string; domain: string; emailProviderConfigEnc: string } | null> {
  return db.merchant.findUnique({
    where: { id: merchantId },
    select: { name: true, domain: true, emailProviderConfigEnc: true },
  });
}
