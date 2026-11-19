import { NextResponse, type NextRequest } from "next/server";
import { handlers } from "@/lib/auth";
import { productOnHost } from "@/app/affiliates/merchantOnHost";

export const { GET } = handlers;

// The affiliate sign-in can be posted here directly as well as through the
// login action, and its own check sits in src/lib, where owners.serves cannot
// be read. A product owners.serves turns away is refused here, before the
// password is looked at or a login attempt counted.
export async function POST(req: NextRequest) {
  if (/\/callback\/affiliate-password\/?$/.test(req.nextUrl.pathname)) {
    const { served } = await productOnHost(req.headers.get("host"));
    if (!served) return new NextResponse(null, { status: 403 });
  }
  return handlers.POST(req);
}
