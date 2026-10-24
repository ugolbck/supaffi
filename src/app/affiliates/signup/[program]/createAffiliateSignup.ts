"use server";

import { headers } from "next/headers";
import { AuthError } from "next-auth";
import { signIn } from "@/lib/auth";
import { getMerchantByDomain } from "@/lib/merchant";
import { getProgramForSignup } from "@/lib/program";
import { createAffiliate } from "@/lib/affiliate";
import { affiliatePasswordError } from "@/lib/affiliatePassword";
import { hashPassword, ConcurrencyLimitError } from "@/lib/password";
import { reserveAffiliateSignup } from "@/lib/affiliateSignupThrottle";
import { clientAddress } from "@/lib/clientAddress";
import { validateSignupInput, validateCode } from "./validation";
import { isUniqueConstraintErrorOn } from "@/lib/prismaErrors";

type FormState = { error: string };

const ALREADY_SIGNED_UP = "You already have an account here. Log in instead.";

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
    return { error: result.error };
  }
  const password = String(formData.get("password") ?? "");
  const passwordError = affiliatePasswordError(password);
  if (passwordError) return { error: passwordError };

  // "codeTouched" is only set once the affiliate has actually edited the
  // live preview under the name field, not merely because it carries a
  // value — the preview auto-fills from the name via JS, so an untouched
  // field always has one too. Only a touched value is a deliberate choice
  // that must be reported as taken rather than silently swapped out.
  let chosenCode: string | null = null;
  if (formData.get("codeTouched") === "1") {
    const validatedCode = validateCode(String(formData.get("code") ?? ""));
    if (validatedCode.error !== null) {
      return { error: validatedCode.error };
    }
    chosenCode = validatedCode.code;
  }

  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  const merchant = host ? await getMerchantByDomain(host) : null;
  if (!merchant) {
    return { error: "Could not determine which program this is for." };
  }

  const program = await getProgramForSignup(merchant.id, programSlug);
  if (!program) {
    return { error: "This signup link is no longer valid." };
  }

  // Before the hash and the insert, so a flood of signups neither fills the
  // Merchant's affiliate list with junk nor holds the Argon2 slots.
  const address = clientAddress(new Headers(requestHeaders));
  if (!reserveAffiliateSignup(merchant.id, address)) {
    return { error: "Too many signups from this network. Try again in a few minutes." };
  }

  let passwordHash: string;
  try {
    passwordHash = await hashPassword(password);
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) return { error: "Busy right now. Try again in a moment." };
    throw err;
  }

  try {
    await createAffiliate(merchant.id, program.id, {
      name: result.name,
      email: result.email,
      passwordHash,
      ...(chosenCode ? { code: chosenCode } : {}),
    });
  } catch (err) {
    if (isUniqueConstraintErrorOn(err, "email")) {
      // Never a login: whoever submits a known email here has not proved
      // they own the account.
      return { error: ALREADY_SIGNED_UP };
    } else if (isUniqueConstraintErrorOn(err, "code")) {
      if (chosenCode) {
        // They typed this one on purpose. Swapping it for a generated code
        // behind their back is the exact surprise finding 11 was about, one
        // step earlier — report it and let them pick another instead.
        return { error: "That code is already taken. Try another." };
      }
      // AffiliateLink.code is globally unique (not scoped to this Merchant) and
      // generated via a read-then-write with no transaction, so two
      // concurrent signups whose names slugify to the same base code can
      // race. Retry once — createAffiliate regenerates the code from
      // scratch, and it'll pick a different one now that the loser's
      // candidate is taken.
      await createAffiliate(merchant.id, program.id, {
        name: result.name,
        email: result.email,
        passwordHash,
      });
    } else {
      throw err;
    }
  }

  try {
    await signIn("affiliate-password", { email: result.email, password, redirectTo: "/affiliates/dashboard" });
  } catch (err) {
    // The account exists either way; a refused login (the throttle, a full
    // Argon2 queue) only means logging in by hand.
    if (err instanceof AuthError) return { error: "Your account is ready. Log in to continue." };
    throw err; // Auth.js throws a redirect internally on success, must re-throw
  }
  return { error: "" };
}
