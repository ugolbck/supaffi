import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";
import { REFERRAL_QUERY_PARAM } from "@/lib/referral";

// Called cross-origin, from the Merchant's own site (wherever the tracking
// script is embedded), not from this Merchant's own domain — so this is
// the one endpoint that deliberately allows any origin. No sensitive data
// goes in or out, and it carries no financial risk by itself (see
// CONTEXT.md); only a signature-verified Stripe webhook event ever creates
// a Commission.
//
// Returns a Referral Token. The script is responsible for storing it as a
// first-party cookie on the Merchant's own domain (document.cookie, set
// client-side — a Set-Cookie header from this response would be scoped to
// Supaffi's domain, not the Merchant's, and would be useless here) so the
// Merchant's own checkout code can read it later and pass it into Stripe.
export async function GET(req: NextRequest) {
  const host = req.headers.get("host");
  const referralCode = req.nextUrl.searchParams.get(REFERRAL_QUERY_PARAM);
  if (!host || !referralCode) {
    return new NextResponse(null, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { domain: host },
    select: { id: true },
  });
  if (!merchant) {
    return new NextResponse(null, { status: 404 });
  }

  const link = await db.affiliateLink.findUnique({
    where: { code: referralCode },
    select: {
      id: true,
      affiliate: {
        select: {
          id: true,
          merchantId: true,
          program: { select: { attributionWindowDays: true } },
        },
      },
    },
  });
  // The code is globally unique, so a code belonging to another Merchant
  // resolves but must not attribute here.
  if (!link || link.affiliate.merchantId !== merchant.id) {
    return new NextResponse(null, { status: 404 });
  }

  const referralToken = randomUUID();
  const expiresAt = new Date(
    Date.now() + link.affiliate.program.attributionWindowDays * 24 * 60 * 60 * 1000
  );

  await db.click.create({
    data: { affiliateId: link.affiliate.id, linkId: link.id, referralToken, expiresAt },
  });

  return NextResponse.json(
    { referralToken },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
