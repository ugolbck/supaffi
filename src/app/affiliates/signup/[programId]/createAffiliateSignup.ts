"use server";

import { headers } from "next/headers";
import { getMerchantByDomain, getMerchantEmailCredentials } from "@/lib/merchant";
import { getProgramForSignup } from "@/lib/program";
import { createAffiliate, getAffiliateByEmail } from "@/lib/affiliate";
import { createAffiliateLoginToken } from "@/lib/affiliateAuth";
import { sendAffiliateMagicLinkEmail } from "@/lib/email/affiliateMagicLink";
import { validateSignupInput } from "./validation";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

type FormState = { status: "form" | "sent"; error: string };

export async function createAffiliateSignup(
  programId: string,
  _prevState: FormState,
  formData: FormData
): Promise<FormState> {
  const result = validateSignupInput({
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
  });
  if (result.error !== null) {
    return { status: "form", error: result.error };
  }

  const host = (await headers()).get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) {
    return { status: "form", error: "Could not determine which program this is for." };
  }

  const program = await getProgramForSignup(merchant.id, programId);
  if (!program) {
    return { status: "form", error: "This signup link is no longer valid." };
  }

  let affiliateId: string;
  try {
    const created = await createAffiliate(merchant.id, program.id, {
      name: result.name,
      email: result.email,
    });
    affiliateId = created.id;
  } catch (err) {
    if (!isUniqueConstraintError(err)) throw err;
    // Already signed up for this Merchant — treat this as a login request
    // instead of erroring, so a repeat visitor just gets back in.
    const existing = await getAffiliateByEmail(merchant.id, result.email);
    if (!existing) throw err; // constraint violated but lookup found nothing — surface the real error
    affiliateId = existing.id;
  }

  const rawToken = await createAffiliateLoginToken(affiliateId);
  const credentials = await getMerchantEmailCredentials(merchant.id);
  if (credentials) {
    await sendAffiliateMagicLinkEmail(credentials, { email: result.email }, rawToken);
  }

  return { status: "sent", error: "" };
}
