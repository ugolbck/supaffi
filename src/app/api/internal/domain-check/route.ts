import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

// Caddy's on-demand TLS "ask" endpoint (see Caddyfile). GET with ?domain=,
// must respond fast and with a 2xx only for a domain we actually recognize,
// otherwise anyone could point an unrelated domain here and get a free
// certificate issued through this server.
export async function GET(req: NextRequest) {
  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return new NextResponse(null, { status: 400 });
  }

  const merchant = await db.merchant.findUnique({
    where: { domain },
    select: { id: true },
  });

  return new NextResponse(null, { status: merchant ? 200 : 403 });
}
