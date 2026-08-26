import { db } from "@/lib/db";
import { generateReferralCode } from "@/lib/referralCode";

export type CreateAffiliateInput = { name: string; email: string };

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export async function createAffiliate(
  merchantId: string,
  programId: string,
  input: CreateAffiliateInput
): Promise<{ id: string; email: string; referralCode: string }> {
  const email = normalizeEmail(input.email);
  const referralCode = await generateReferralCode(input.name);

  return db.affiliate.create({
    data: {
      merchantId,
      programId,
      email,
      name: input.name,
      referralCode,
    },
    select: { id: true, email: true, referralCode: true },
  });
}

export async function getAffiliateByEmail(
  merchantId: string,
  email: string
): Promise<{ id: string; email: string; referralCode: string } | null> {
  return db.affiliate.findUnique({
    where: { merchantId_email: { merchantId, email: normalizeEmail(email) } },
    select: { id: true, email: true, referralCode: true },
  });
}

export async function getAffiliateSession(
  affiliateId: string
): Promise<{ referralCode: string; merchantWebsiteUrl: string } | null> {
  const affiliate = await db.affiliate.findUnique({
    where: { id: affiliateId },
    select: { referralCode: true, merchant: { select: { websiteUrl: true } } },
  });
  if (!affiliate) return null;
  return {
    referralCode: affiliate.referralCode,
    merchantWebsiteUrl: affiliate.merchant.websiteUrl,
  };
}
