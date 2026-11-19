import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ext } from "@/extensions";
import { clientAddress, isPrivateAddress } from "@/lib/clientAddress";
import { servedDomain } from "@/lib/domainOwnership";

// Caddy's on-demand TLS "ask" endpoint (see Caddyfile). GET with ?domain=,
// must respond fast and with a 2xx only for a domain we actually recognize,
// otherwise anyone could point an unrelated domain here and get a free
// certificate issued through this server.
export async function GET(req: NextRequest) {
  // Caddy asks over the Docker network, so the request comes from a private
  // address. Anything relayed from the internet by the proxy carries the
  // visitor's public address, and has no business learning which domains are
  // Merchants. Presence of X-Forwarded-For alone cannot tell the two apart:
  // Next fills it in from the socket when a request arrives without one.
  const address = clientAddress(req.headers);
  if (address !== null && !isPrivateAddress(address)) {
    return new NextResponse(null, { status: 404 });
  }

  const domain = req.nextUrl.searchParams.get("domain");
  if (!domain) {
    return new NextResponse(null, { status: 400 });
  }

  // A domain whose ownership is still unproven, when proof is required, or
  // whose product owners.serves turns away, is refused like an unknown one.
  const merchant = await db.merchant.findFirst({
    where: servedDomain(domain),
    select: { ownerId: true },
  });
  const served = merchant !== null && (await ext.owners.serves(merchant.ownerId));

  return new NextResponse(null, { status: served ? 200 : 403 });
}
