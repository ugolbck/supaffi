/**
 * Reading another tool's API: JSON over HTTPS, waiting out its rate limit
 * rather than failing on it, and a refusal of the key said in words the
 * Owner can act on.
 */

export class ImportApiError extends Error {}

/** Where every tool's API lives. Unset on real installs; the end-to-end suite points it at a fake. */
export function apiBase(real: string): string {
  const override = process.env.SUPAFFI_IMPORT_API_BASE?.trim();
  if (!override) return real;
  return `${override.replace(/\/$/, "")}${new URL(real).pathname.replace(/\/$/, "")}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * One GET, retried on a rate limit or a server error. `label` names the tool
 * in what the Owner reads when it fails.
 */
export async function getJson<T>(
  url: string,
  headers: Record<string, string>,
  label: string,
  { attempts = 6 }: { attempts?: number } = {}
): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(url, { headers: { accept: "application/json", ...headers }, signal: AbortSignal.timeout(30_000) });
    } catch {
      if (attempt >= attempts) throw new ImportApiError(`${label} did not answer. Try again in a few minutes.`);
      await sleep(2_000 * attempt);
      continue;
    }
    if (res.ok) return (await res.json()) as T;
    if (res.status === 401 || res.status === 403) {
      throw new ImportApiError(`${label} refused the API key. Check it and start again.`);
    }
    if ((res.status === 429 || res.status >= 500) && attempt < attempts) {
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 5_000 * attempt);
      continue;
    }
    throw new ImportApiError(`${label} answered ${res.status}. Try again in a few minutes.`);
  }
}

/** Spaces requests out to stay under a limit of `max` per `windowMs`. */
export function throttle(max: number, windowMs: number): () => Promise<void> {
  const sent: number[] = [];
  return async () => {
    for (;;) {
      const now = Date.now();
      while (sent.length && now - sent[0] >= windowMs) sent.shift();
      if (sent.length < max) {
        sent.push(now);
        return;
      }
      await sleep(windowMs - (now - sent[0]) + 10);
    }
  };
}
