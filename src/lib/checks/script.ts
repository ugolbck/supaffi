import type { CheckResult } from "@/lib/checks/dns";

/**
 * Fetches the product's homepage and looks for its own tracking script.
 *
 * Only http and https are fetched, and the URL is the one the owner entered
 * for their own product, so this is not a general purpose fetcher. The body
 * is capped at 2 MB: a homepage larger than that is not going to have the
 * script tag in its first two megabytes anyway.
 */
export async function scriptFound(
  websiteUrl: string,
  trackingDomain: string,
  fetchFn: typeof fetch = fetch
): Promise<CheckResult> {
  let url: URL;
  try {
    url = new URL(websiteUrl);
  } catch {
    return { ok: false, detail: "The website address is not valid" };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, detail: "The website address is not valid" };
  }

  let html: string;
  try {
    const response = await fetchFn(url.toString(), {
      headers: { "user-agent": "Supaffi tracking check" },
      signal: AbortSignal.timeout(8000),
    });
    html = (await response.text()).slice(0, 2 * 1024 * 1024);
  } catch {
    return { ok: false, detail: "Could not load the site" };
  }

  const escaped = trackingDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<script[^>]*src\\s*=\\s*["']https?://${escaped}/track\\.js["'][^>]*>`, "i");
  return tag.test(html)
    ? { ok: true, detail: `Found on ${url.hostname}` }
    : { ok: false, detail: `Not found on ${url.hostname}` };
}
