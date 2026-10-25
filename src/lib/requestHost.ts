import { headers } from "next/headers";

// The host the visitor asked for, as a page sees it.
//
// Not the Host header alone. When a server action redirects, Next renders the
// target page inside that same request, and in that render Host is the app's
// own address (the container's name and port) rather than the product's
// domain. The proxy in front (Caddy) always sets X-Forwarded-Host to the name
// the browser used, and it survives into that render. Reading Host there made
// every affiliate login and signup land back on the login page in production,
// while local development, where both are localhost, never showed it.
export async function requestHost(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-host") ?? h.get("host");
}
