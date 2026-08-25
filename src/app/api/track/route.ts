import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { db } from "@/lib/db";

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
  const referralCode = req.nextUrl.searchParams.get("ref");
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

  const affiliate = await db.affiliate.findUnique({
    where: { referralCode, merchantId: merchant.id },
    select: { id: true, program: { select: { attributionWindowDays: true } } },
  });
  if (!affiliate) {
    return new NextResponse(null, { status: 404 });
  }

  const referralToken = randomUUID();
  const expiresAt = new Date(
    Date.now() + affiliate.program.attributionWindowDays * 24 * 60 * 60 * 1000
  );

  await db.click.create({
    data: { affiliateId: affiliate.id, referralToken, expiresAt },
  });

  return NextResponse.json(
    { referralToken },
    { headers: { "Access-Control-Allow-Origin": "*" } }
  );
}
