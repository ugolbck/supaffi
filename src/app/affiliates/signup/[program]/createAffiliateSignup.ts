"use server";

import { headers } from "next/headers";
import { getMerchantByDomain, getMerchantEmailCredentials } from "@/lib/merchant";
import { getProgramForSignup } from "@/lib/program";
import { createAffiliate, getAffiliateByEmail } from "@/lib/affiliate";
import { createAffiliateLoginToken } from "@/lib/affiliateAuth";
import { sendAffiliateMagicLinkEmail } from "@/lib/email/affiliateMagicLink";
import { validateSignupInput } from "./validation";
import { isUniqueConstraintErrorOn } from "@/lib/prismaErrors";

type FormState = { status: "form" | "sent"; error: string };

export async function createAffiliateSignup(
  programSlug: string,
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

  const program = await getProgramForSignup(merchant.id, programSlug);
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
    if (isUniqueConstraintErrorOn(err, "email")) {
      // Already signed up for this Merchant — treat this as a login request
      // instead of erroring, so a repeat visitor just gets back in.
      const existing = await getAffiliateByEmail(merchant.id, result.email);
      if (!existing) throw err; // constraint violated but lookup found nothing — surface the real error
      affiliateId = existing.id;
    } else if (isUniqueConstraintErrorOn(err, "referralCode")) {
      // referralCode is globally unique (not scoped to this Merchant) and
      // generated via a read-then-write with no transaction, so two
      // concurrent signups whose names slugify to the same base code can
      // race. Retry once — createAffiliate regenerates the code from
      // scratch, and it'll pick a different one now that the loser's
      // candidate is taken.
      const retried = await createAffiliate(merchant.id, program.id, {
        name: result.name,
        email: result.email,
      });
      affiliateId = retried.id;
    } else {
      throw err;
    }
  }

  const rawToken = await createAffiliateLoginToken(affiliateId);
  const credentials = await getMerchantEmailCredentials(merchant.id);
  if (credentials) {
    await sendAffiliateMagicLinkEmail(credentials, { email: result.email }, rawToken);
  }

  return { status: "sent", error: "" };
}
