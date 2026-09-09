import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { resolvesTo as resolvesToImpl, httpsReachable as httpsReachableImpl, type CheckResult } from "@/lib/checks/dns";
import { stripeKeyWorks as stripeKeyWorksImpl, webhookEventReceived as webhookEventReceivedImpl } from "@/lib/checks/stripe";
import { resendKeyWorks as resendKeyWorksImpl, sendingDomainVerified as sendingDomainVerifiedImpl } from "@/lib/checks/email";
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

/**
 * The last result per product, so a page that only cares about one section
 * does not re-run the other three. Module level, which is per server process:
 * a wrong entry costs at most a minute of a stale light, and the step the
 * Owner is standing on always asks for its own section fresh.
 */
const recent = new Map<string, { checks: ProductChecks; at: number }>();
const MAX_AGE_MS = 60_000;
const SECTIONS = ["dns", "stripe", "email", "tracking"] as const;

export type RunOptions = {
  /** Sections to run no matter how recent the last result is. */
  fresh?: ReadonlySet<CheckSection>;
  /** Test injection. Nothing in the app passes these. */
  overrides?: Partial<CheckDeps>;
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
export async function runProductChecks(
  ownerId: string,
  merchantId: string,
  options: RunOptions = {}
): Promise<ProductChecks> {
  const deps = { ...defaults, ...options.overrides };
  const cached = recent.get(merchantId);
  const warm = cached && Date.now() - cached.at < MAX_AGE_MS ? cached.checks : null;
  const runs = (section: CheckSection) => warm === null || (options.fresh?.has(section) ?? false);

  // Nothing to run: no database round trip either, which is the point.
  if (warm && !SECTIONS.some(runs)) return warm;

  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { domain: true, websiteUrl: true, stripeSecretKeyEnc: true, emailProviderConfigEnc: true },
  });
  if (!merchant) throw new Error("Merchant not found");

  const hostIp = process.env.SUPAFFI_HOST_IP?.trim() ?? "";
  const stripeKey = safeDecrypt(merchant.stripeSecretKeyEnc);
  const resendKey = safeDecrypt(merchant.emailProviderConfigEnc);

  const [dns, stripe, email, tracking] = await Promise.all([
    runs("dns")
      ? (async () => {
          const [resolves, https] = await Promise.all([
            hostIp ? settle(deps.resolvesTo(merchant.domain, hostIp), FAILED) : Promise.resolve(NO_ADDRESS),
            settle(deps.httpsReachable(merchant.domain), { reachable: FAILED, certificate: FAILED }),
          ]);
          return { resolves, https: https.reachable, certificate: https.certificate };
        })()
      : Promise.resolve(warm!.dns),
    runs("stripe")
      ? (async () => {
          const [key, webhook] = await Promise.all([
            stripeKey ? settle(deps.stripeKeyWorks(stripeKey), FAILED) : Promise.resolve(NOT_CONNECTED),
            settle(deps.webhookEventReceived(ownerId, merchantId), FAILED),
          ]);
          return { key, webhook };
        })()
      : Promise.resolve(warm!.stripe),
    runs("email")
      ? (async () => {
          const [key, domain] = await Promise.all([
            resendKey ? settle(deps.resendKeyWorks(resendKey), FAILED) : Promise.resolve(NOT_CONNECTED),
            resendKey
              ? settle(deps.sendingDomainVerified(resendKey, merchant.domain), FAILED)
              : Promise.resolve(NOT_CONNECTED),
          ]);
          return { key, domain };
        })()
      : Promise.resolve(warm!.email),
    runs("tracking")
      ? (async () => ({ script: await settle(deps.scriptFound(merchant.websiteUrl, merchant.domain), FAILED) }))()
      : Promise.resolve(warm!.tracking),
  ]);

  const checks: ProductChecks = { dns, stripe, email, tracking };
  recent.set(merchantId, { checks, at: Date.now() });
  return checks;
}

function safeDecrypt(ciphertext: string | null): string | null {
  if (!ciphertext) return null;
  try {
    return decrypt(ciphertext);
  } catch {
    return null;
  }
}
