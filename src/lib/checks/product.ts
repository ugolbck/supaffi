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
  webhookEventReceived: (merchantId: string) => Promise<CheckResult>;
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

/**
 * Every light on the onboarding rail and the settings page, from one call.
 * Credentials are decrypted here and handed to the checks; they never leave
 * this function. A decrypt failure reads as not connected, which is what the
 * settings page should say when the master key has been lost.
 */
export async function runProductChecks(
  ownerId: string,
  merchantId: string,
  overrides: Partial<CheckDeps> = {}
): Promise<ProductChecks> {
  const deps = { ...defaults, ...overrides };
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { domain: true, websiteUrl: true, stripeSecretKeyEnc: true, emailProviderConfigEnc: true },
  });
  if (!merchant) throw new Error("Merchant not found");

  const hostIp = process.env.SUPAFFI_HOST_IP?.trim() ?? "";
  const stripeKey = safeDecrypt(merchant.stripeSecretKeyEnc);
  const resendKey = safeDecrypt(merchant.emailProviderConfigEnc);

  const [resolves, https, stripeKeyResult, webhook, emailKey, emailDomain, script] = await Promise.all([
    hostIp ? deps.resolvesTo(merchant.domain, hostIp) : Promise.resolve(NO_ADDRESS),
    deps.httpsReachable(merchant.domain),
    stripeKey ? deps.stripeKeyWorks(stripeKey) : Promise.resolve(NOT_CONNECTED),
    deps.webhookEventReceived(merchantId),
    resendKey ? deps.resendKeyWorks(resendKey) : Promise.resolve(NOT_CONNECTED),
    resendKey ? deps.sendingDomainVerified(resendKey, merchant.domain) : Promise.resolve(NOT_CONNECTED),
    deps.scriptFound(merchant.websiteUrl, merchant.domain),
  ]);

  return {
    dns: { resolves, https: https.reachable, certificate: https.certificate },
    stripe: { key: stripeKeyResult, webhook },
    email: { key: emailKey, domain: emailDomain },
    tracking: { script },
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
