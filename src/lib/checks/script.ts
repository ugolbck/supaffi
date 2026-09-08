import type { CheckResult } from "@/lib/checks/dns";

const MAX_BYTES = 2 * 1024 * 1024;

/**
 * Reads a response body up to `capBytes`, decoding as it goes, and stops
 * pulling from the stream once the cap is reached instead of buffering the
 * whole body and truncating afterwards — a large homepage would otherwise
 * sit fully in memory just to be cut down a moment later. Cancels the
 * reader once done so the rest of the body is not held open. Falls back to
 * `response.text()` when the runtime gives no readable stream body, cut to
 * the same cap so no path returns more than `capBytes`.
 */
async function readCapped(response: Response, capBytes: number): Promise<string> {
  if (!response.body) return (await response.text()).slice(0, capBytes);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let text = "";
  try {
    while (received < capBytes) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    text += decoder.decode();
    await reader.cancel().catch(() => {});
  }
  // The loop stops after the chunk that crossed the cap, and a single chunk
  // can be any size, so the last one can carry the total well past it. Cut
  // here as well, so the cap holds on every path rather than only on average.
  return text.slice(0, capBytes);
}

/**
 * Fetches the product's homepage and looks for its own tracking script.
 *
 * Only http and https are fetched, and the URL is the one the owner entered
 * for their own product, so this is not a general purpose fetcher. The read
 * is capped at 2 MB, enforced while streaming rather than after buffering
 * the whole body: a homepage larger than that is not going to have the
 * script tag in its first two megabytes anyway, and there is no reason to
 * hold the rest of it in memory to find that out.
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
    // Redirects are followed (fetch's default): an owner's homepage commonly
    // redirects to www or to https, and the script tag lives on whatever page
    // the browser actually lands on.
    const response = await fetchFn(url.toString(), {
      headers: { "user-agent": "Supaffi tracking check" },
      signal: AbortSignal.timeout(8000),
    });
    html = await readCapped(response, MAX_BYTES);
  } catch {
    return { ok: false, detail: "Could not load the site" };
  }

  const escaped = trackingDomain.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const tag = new RegExp(`<script[^>]*src\\s*=\\s*["']https?://${escaped}/track\\.js["'][^>]*>`, "i");
  return tag.test(html)
    ? { ok: true, detail: `Found on ${url.hostname}` }
    : { ok: false, detail: `Not found on ${url.hostname}` };
}
