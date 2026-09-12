import { Resend } from "resend";
import type { CheckResult } from "@/lib/checks/dns";

export type MinimalResend = {
  domains: {
    list: () => Promise<{
      data?: { data?: { name: string; status: string }[] } | null;
      error?: { message: string } | null;
    }>;
  };
};

function defaultClient(key: string): MinimalResend {
  return new Resend(key) as unknown as MinimalResend;
}

/**
 * Resend's client has no timeout of its own, so a request that never gets
 * an answer left the key screen saying "Checking" until someone reloaded.
 * Ten seconds is long past anything Resend takes when it is up.
 */
const TIMEOUT_MS = 10_000;

function withTimeout<T>(promise: Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

export function resendDomainsUrl(): string {
  return "https://resend.com/domains";
}

export async function resendKeyWorks(
  apiKey: string,
  makeClient: (key: string) => MinimalResend = defaultClient
): Promise<CheckResult> {
  if (!apiKey.startsWith("re_")) return { ok: false, detail: "That is not a Resend API key" };
  try {
    const response = await withTimeout(makeClient(apiKey).domains.list());
    if (response.error) return { ok: false, detail: "Resend says this key is not valid" };
    return { ok: true, detail: "Key works" };
  } catch (err) {
    console.warn(`[checks] resend key: ${(err as Error).message}`);
    return { ok: false, detail: "Could not reach Resend" };
  }
}

/**
 * Whether Resend will send from affiliates@<domain>. Resend only covers the
 * exact domain that was verified; a verified parent does not cover its
 * subdomains, they have to be added and verified on their own. This step is
 * what makes the magic links deliverable at all; without it every affiliate
 * login fails.
 */
export async function sendingDomainVerified(
  apiKey: string,
  domain: string,
  makeClient: (key: string) => MinimalResend = defaultClient
): Promise<CheckResult> {
  try {
    const response = await withTimeout(makeClient(apiKey).domains.list());
    if (response.error) return { ok: false, detail: "Resend says this key is not valid" };
    const domains = response.data?.data ?? [];
    const match = domains.find((d) => d.name === domain);
    if (!match) return { ok: false, detail: `Add ${domain} in Resend` };
    if (match.status !== "verified") {
      return { ok: false, detail: `Added, ${match.status}. Check the records in Resend.` };
    }
    return { ok: true, detail: `Verified as ${match.name}` };
  } catch (err) {
    console.warn(`[checks] resend domain ${domain}: ${(err as Error).message}`);
    return { ok: false, detail: "Could not reach Resend" };
  }
}
