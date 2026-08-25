import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { Prisma } from "@prisma/client";
import { isUniqueConstraintError } from "@/lib/prismaErrors";

// One instance can host several Merchants (ADR 0006), each on their own
// domain, so the Merchant is resolved by which domain the request arrived
// on, same as regular traffic. Each Merchant has their own webhook signing
// secret, verified independently.
//
// This only verifies the signature and queues the event (ADR 0007) — it
// does not process it. Processing happens in the background worker, so
// this handler stays fast and returns 200 quickly, which is what Stripe
// expects to stop retrying.
export async function POST(req: NextRequest) {
  const host = req.headers.get("host");
  const signature = req.headers.get("stripe-signature");
  if (!host || !signature) {
    return new NextResponse(null, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { domain: host },
    select: { id: true, stripeWebhookSecretEnc: true },
  });
  if (!merchant) {
    return new NextResponse(null, { status: 404 });
  }

  const rawBody = await req.text();
  let event: Stripe.Event;
  try {
    const webhookSecret = decrypt(merchant.stripeWebhookSecretEnc);
    event = Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    // Bad signature — reject outright, never queue an unverified payload.
    return new NextResponse(null, { status: 400 });
  }

  try {
    await db.webhookEvent.create({
      data: {
        merchantId: merchant.id,
        stripeEventId: event.id,
        payload: event as unknown as Prisma.InputJsonValue,
      },
    });
  } catch (err) {
    // Unique constraint on stripeEventId — Stripe redelivered an event we
    // already have queued. Not an error, still a success from Stripe's
    // point of view.
    if (!isUniqueConstraintError(err)) {
      throw err;
    }
  }

  return new NextResponse(null, { status: 200 });
}
