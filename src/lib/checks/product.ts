import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { resolvesTo as resolvesToImpl, httpsReachable as httpsReachableImpl, type CheckResult } from "@/lib/checks/dns";
import { stripeKeyWorks as stripeKeyWorksImpl, webhookEventReceived as webhookEventReceivedImpl } from "@/lib/checks/stripe";
import {
  resendKeyWorks as resendKeyWorksImpl,
  sendingDomainVerified as sendingDomainVerifiedImpl,
} from "@/lib/checks/email";
import { scriptFound as scriptFoundImpl } from "@/lib/checks/script";

export type CheckDeps = {
  resolvesTo: (hostname: string, ip: string) => Promise<CheckResult>;
  httpsReachable: (hostname: string) => Promise<{ reachable: CheckResult; certificate: CheckResult }>;
  stripeKeyWorks: (key: string) => Promise<CheckResult>;
  webhookEventReceived: (ownerId: string, merchantId: string) => Promise<CheckResult>;
  resendKeyWorks: (key: string) => Promise<CheckResult>;
  sendingDomainVerified: (key: string, domain: string) => Promise<CheckResult>;
  scriptFound: (websiteUrl: string, domain: string) => Promise<CheckResult>;
};

const defaults: CheckDeps = {
  resolvesTo: resolvesToImpl,
  httpsReachable: httpsReachableImpl,
  stripeKeyWorks: stripeKeyWorksImpl,
  webhookEventReceived: webhookEventReceivedImpl,
  resendKeyWorks: resendKeyWorksImpl,
  sendingDomainVerified: sendingDomainVerifiedImpl,
  scriptFound: scriptFoundImpl,
};

export type ProductChecks = {
  dns: { resolves: CheckResult; https: CheckResult; certificate: CheckResult };
  stripe: { key: CheckResult; webhook: CheckResult };
  email: { key: CheckResult; domain: CheckResult };
  tracking: { script: CheckResult };
};

const NOT_CONNECTED: CheckResult = { ok: false, detail: "Not connected yet" };
/**
 * What a light says before anyone has looked. Every pending predicate in
 * `checkRows.ts` accepts this exact string, so a screen that arrives before
 * its checks shows grey dots rather than a wall of red crosses.
 */
const CHECKING: CheckResult = { ok: false, detail: "Checking" };
const NO_ADDRESS: CheckResult = { ok: false, detail: "This server's address is not configured" };
const FAILED: CheckResult = { ok: false, detail: "Could not check" };

/**
 * Runs one check and turns a rejection into its own failed CheckResult
 * instead of letting it take the other six lights down with it (a Promise.all
 * of unguarded checks rejects as a whole on the first rejection). Each check
 * is caught at its own call site, not centrally, so a slow or flaky check
 * (webhookEventReceived hitting the database, for instance) degrades to
 * "could not check" without touching the rest.
 */
function settle<T>(promise: Promise<T>, fallback: T): Promise<T> {
  return promise.catch(() => fallback);
}

export type CheckSection = keyof ProductChecks;

type Timed<T> = { value: T; at: number };

/**
 * The last result per product, section by section, so a page that only cares
 * about one section does not re-run the other three. Module level, which is
 * per server process: a wrong entry costs at most a minute of a stale light,
 * and the step the Owner is standing on always asks for its own section fresh.
 *
 * Each section carries its own timestamp. One timestamp for the whole product
 * would be pushed forward by every poll of the current step, and the three
 * sections nobody asked for would then never expire at all.
 */
type SectionCache = {
  dns?: Timed<ProductChecks["dns"]>;
  stripe?: Timed<ProductChecks["stripe"]>;
  email?: Timed<ProductChecks["email"]>;
  tracking?: Timed<ProductChecks["tracking"]>;
};

const recent = new Map<string, SectionCache>();
const MAX_AGE_MS = 60_000;

export type RunOptions = {
  /** Sections to run no matter how recent the last result is. */
  fresh?: ReadonlySet<CheckSection>;
  /**
   * Answer from what is already known and run the rest behind the request.
   *
   * This is what a step screen uses. These checks are DNS lookups, a TLS
   * handshake, a Stripe call, a Resend call and a fetch of the Owner's own
   * website, and awaiting them put two or three seconds between pressing a
   * button and seeing the next screen, with nothing on the screen to say
   * why. The screen now arrives at once with its lights grey and they turn
   * over a second or two later, which is both faster and more honest: those
   * lights are watching the outside world, and the outside world answers
   * when it answers.
   */
  background?: boolean;
  /** Test injection. Nothing in the app passes these. */
  overrides?: Partial<CheckDeps>;
  /** Test seam: the clock the sixty second window is measured against. */
  now?: () => number;
};

/**
 * Every light on the onboarding rail and the settings page, from one call.
 * Credentials are decrypted here and handed to the checks; they never leave
 * this function. A decrypt failure reads as not connected, which is what the
 * settings page should say when the master key has been lost.
 *
 * The onboarding steps poll every 15 seconds. Running all seven checks each
 * time meant a Stripe, a Resend and two outbound HTTP requests per tick for
 * lights nobody was looking at, which is how an instance gets rate limited
 * during the one hour it matters. So a section that was run less than a
 * minute ago is served from the last result unless the caller names it in
 * `fresh`.
 */
/** The last answer for a section, whatever its age, or the not-looked-yet one. */
function lastKnown(cached: SectionCache): ProductChecks {
  return {
    dns: cached.dns?.value ?? { resolves: CHECKING, https: CHECKING, certificate: CHECKING },
    stripe: cached.stripe?.value ?? { key: CHECKING, webhook: CHECKING },
    email: cached.email?.value ?? { key: CHECKING, domain: CHECKING },
    tracking: cached.tracking?.value ?? { script: CHECKING },
  };
}

// One run per product per section at a time. Without this, a screen polling
// every five seconds while a slow website fetch is still going would start a
// second, a third and a fourth.
const inFlight = new Map<string, Promise<Partial<ProductChecks>>>();

/**
 * Runs the named sections for real and writes them to the cache.
 *
 * Deduplicated per product and section: a second caller while one is running
 * waits on the first rather than starting its own.
 */
function refresh(
  ownerId: string,
  merchantId: string,
  sections: CheckSection[],
  deps: CheckDeps,
  now: () => number
): Promise<Partial<ProductChecks>> {
  const key = `${merchantId}:${[...sections].sort().join(",")}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async (): Promise<Partial<ProductChecks>> => {
    const started = now();
    const merchant = await db.merchant.findFirst({
      where: { id: merchantId, ownerId },
      select: { domain: true, websiteUrl: true, stripeSecretKeyEnc: true, emailProviderConfigEnc: true },
    });
    if (!merchant) throw new Error("Merchant not found");

    const hostIp = process.env.SUPAFFI_HOST_IP?.trim() ?? "";
    const stripeKey = safeDecrypt(merchant.stripeSecretKeyEnc);
    const resendKey = safeDecrypt(merchant.emailProviderConfigEnc);
    const wanted = new Set(sections);
    const result: Partial<ProductChecks> = {};

    await Promise.all([
      wanted.has("dns")
        ? (async () => {
            const [resolves, https] = await Promise.all([
              hostIp ? settle(deps.resolvesTo(merchant.domain, hostIp), FAILED) : Promise.resolve(NO_ADDRESS),
              settle(deps.httpsReachable(merchant.domain), { reachable: FAILED, certificate: FAILED }),
            ]);
            result.dns = { resolves, https: https.reachable, certificate: https.certificate };
          })()
        : null,
      wanted.has("stripe")
        ? (async () => {
            const [key, webhook] = await Promise.all([
              stripeKey ? settle(deps.stripeKeyWorks(stripeKey), FAILED) : Promise.resolve(NOT_CONNECTED),
              settle(deps.webhookEventReceived(ownerId, merchantId), FAILED),
            ]);
            result.stripe = { key, webhook };
          })()
        : null,
      wanted.has("email")
        ? (async () => {
            const [key, domain] = await Promise.all([
              resendKey ? settle(deps.resendKeyWorks(resendKey), FAILED) : Promise.resolve(NOT_CONNECTED),
              resendKey
                ? settle(deps.sendingDomainVerified(resendKey, merchant.domain), FAILED)
                : Promise.resolve(NOT_CONNECTED),
            ]);
            result.email = { key, domain };
          })()
        : null,
      wanted.has("tracking")
        ? (async () => {
            result.tracking = { script: await settle(deps.scriptFound(merchant.websiteUrl, merchant.domain), FAILED) };
          })()
        : null,
    ]);

    const at = now();
    const cached = recent.get(merchantId) ?? {};
    const next: SectionCache = { ...cached };
    for (const section of sections) {
      const value = result[section];
      if (!value) continue;
      // The one trace a self-hosted instance has of what its checks are
      // doing, and how long the outside world took to answer.
      console.log(`[checks] ${section} ${merchant.domain} ${at - started}ms ${JSON.stringify(value)}`);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (next as any)[section] = { value, at };
    }
    recent.set(merchantId, next);
    return result;
  })();

  inFlight.set(key, run);
  // Cleared however it ends, or one rejection would wedge the section for
  // the life of the process.
  void run.catch(() => {}).finally(() => inFlight.delete(key));
  return run;
}

/**
 * Every light on the onboarding rail and the settings page, from one call.
 * Credentials are decrypted here and handed to the checks; they never leave
 * this function. A decrypt failure reads as not connected, which is what the
 * settings page should say when the master key has been lost.
 *
 * The onboarding steps poll every few seconds. Running all seven checks each
 * time meant a Stripe, a Resend and two outbound HTTP requests per tick for
 * lights nobody was looking at, which is how an instance gets rate limited
 * during the one hour it matters. So a section that was run less than a
 * minute ago is served from the last result unless the caller names it in
 * `fresh`.
 */
export async function runProductChecks(
  ownerId: string,
  merchantId: string,
  options: RunOptions = {}
): Promise<ProductChecks> {
  const deps = { ...defaults, ...options.overrides };
  const now = options.now ?? Date.now;
  const stamp = now();
  const cached = recent.get(merchantId) ?? {};
  const usable = <T>(entry: Timed<T> | undefined, section: CheckSection): T | null => {
    if (!entry || options.fresh?.has(section)) return null;
    return stamp - entry.at < MAX_AGE_MS ? entry.value : null;
  };
  const warm = {
    dns: usable(cached.dns, "dns"),
    stripe: usable(cached.stripe, "stripe"),
    email: usable(cached.email, "email"),
    tracking: usable(cached.tracking, "tracking"),
  };
  const stale = (["dns", "stripe", "email", "tracking"] as const).filter((s) => !warm[s]);

  // Nothing to run: no database round trip either, which is the point.
  if (stale.length === 0) {
    return { dns: warm.dns!, stripe: warm.stripe!, email: warm.email!, tracking: warm.tracking! };
  }

  if (options.background) {
    // Deliberately not awaited. The screen goes out now; the answers land in
    // the cache and the next poll picks them up.
    void refresh(ownerId, merchantId, stale, deps, now).catch(() => {});
    const known = lastKnown(cached);
    return {
      dns: warm.dns ?? known.dns,
      stripe: warm.stripe ?? known.stripe,
      email: warm.email ?? known.email,
      tracking: warm.tracking ?? known.tracking,
    };
  }

  const ran = await refresh(ownerId, merchantId, stale, deps, now);
  const known = lastKnown(cached);
  return {
    dns: warm.dns ?? ran.dns ?? known.dns,
    stripe: warm.stripe ?? ran.stripe ?? known.stripe,
    email: warm.email ?? ran.email ?? known.email,
    tracking: warm.tracking ?? ran.tracking ?? known.tracking,
  };
}

function safeDecrypt(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}
