import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { Prisma } from "@prisma/client";
import { isUniqueConstraintError } from "@/lib/prismaErrors";
import { shouldLogSignatureFailure } from "@/lib/webhookSignatureLog";
import { paymentProviderBySlug } from "@/lib/payments";

// One instance can host several Merchants (ADR 0006), each on their own
// domain, so the Merchant is resolved by which domain the request arrived
// on, same as regular traffic. Each Merchant has their own webhook signing
// secret, verified independently. The last segment of the address names the
// payment provider, /api/webhooks/stripe for Stripe.
//
// This only verifies the signature and queues the event (ADR 0007) — it
// does not process it. Processing happens in the background worker, so
// this handler stays fast and returns 200 quickly, which is what a provider
// expects to stop retrying.
export async function POST(req: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const provider = paymentProviderBySlug((await params).provider);
  const host = req.headers.get("host");
  if (!provider) {
    return new NextResponse(null, { status: 404 });
  }
  if (!host || !req.headers.get(provider.signatureHeader)) {
    return new NextResponse(null, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { domain: host },
    select: { id: true, paymentProvider: true, webhookSecretEnc: true },
  });
  // No webhook secret means the provider was never connected for this
  // Merchant, so there is nothing to verify the signature against, and a
  // Merchant on another provider has no secret for this one. Treated the same
  // as an unknown domain: reject, never queue an unverifiable payload.
  if (!merchant || !merchant.webhookSecretEnc || merchant.paymentProvider !== provider.id) {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await req.text();
  let verified;
  try {
    verified = provider.verifyWebhook({ rawBody, headers: req.headers, secret: decrypt(merchant.webhookSecretEnc) });
  } catch {
    verified = null;
  }
  if (!verified) {
    // Bad signature: reject outright, never queue an unverified payload.
    //
    // This used to fail in silence, so a rotated or mistyped signing secret
    // left nothing in the logs to say why no sale arrived. The address is
    // public, so the line does not claim the secret is wrong, and it is
    // limited to one per product every 15 minutes.
    if (shouldLogSignatureFailure(merchant.id)) {
      console.warn(
        `[webhook] rejected a request for merchant ${merchant.id}: its signature did not verify against the signing secret on file.`
      );
    }
    return new NextResponse(null, { status: 400 });
  }

  try {
    await db.webhookEvent.create({
      data: {
        merchantId: merchant.id,
        providerEventId: verified.eventId,
        payload: verified.payload as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Unique constraint on providerEventId: the provider redelivered an event
    // we already have queued. Not an error, still a success from its point of
    // view.
    if (!isUniqueConstraintError(err)) {
      throw err;
    }
  }

  return new NextResponse(null, { status: 200 });
}
