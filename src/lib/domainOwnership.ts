import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { staticExt } from "@/extensions/static";
import { isLocalDomain } from "@/lib/url";
import { resolveTxtAuthoritative, type CheckResult } from "@/lib/checks/dns";

// Proof that an Owner controls their product's domain, required only when
// staticExt.domains.requireOwnershipProof is set. With several Owners on one
// server and no proof, any of them could claim somebody else's domain, have it
// served and get it a certificate. Off by default, and then nothing here
// changes anything.

/** How long a proven domain that was given up stays with the Owner who gave it up. */
export const DOMAIN_HOLD_DAYS = 7;
/** How many domains one Owner can have waiting for proof at once. */
export const MAX_UNVERIFIED_DOMAINS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

export function ownershipProofRequired(): boolean {
  return staticExt.domains.requireOwnershipProof;
}

/**
 * The lookup every request on a product's domain goes through. With proof
 * required, a domain not proven yet matches no product, so it is not served
 * and Caddy is refused a certificate for it.
 */
export function servedDomain(domain: string): { domain: string; domainVerifiedAt?: { not: null } } {
  return ownershipProofRequired() ? { domain, domainVerifiedAt: { not: null } } : { domain };
}

/** The TXT record that proves a domain: where it goes and what it says. */
export function ownershipRecord(domain: string, token: string): { name: string; value: string } {
  return { name: `_supaffi.${domain}`, value: `supaffi-verification=${token}` };
}

/** Thrown by product writes when the domain cannot be claimed. The message is for the Owner. */
export class DomainClaimError extends Error {}

/**
 * Refuses a domain this Owner cannot take, and returns what a product taking
 * it stores. Called for a new product and for a product's domain change,
 * never for a save that keeps the domain. `merchantId` is the product being
 * changed, left out of the count of domains waiting for proof.
 *
 * An unproven claim blocks nobody: another Owner's product waiting on the same
 * domain loses it here, so whoever proves it first keeps it. A proven domain,
 * or one this Owner's own product holds, is left alone and the write that
 * follows is refused as a duplicate.
 */
export async function claimDomain(
  ownerId: string,
  domain: string,
  merchantId?: string
): Promise<{ domainToken: string | null; domainVerifiedAt: Date | null }> {
  // Off, or a machine nothing outside can reach: live at once, as always.
  if (!ownershipProofRequired() || isLocalDomain(domain)) {
    return { domainToken: null, domainVerifiedAt: new Date() };
  }

  const held = await db.releasedDomain.findUnique({ where: { domain } });
  if (held && held.ownerId !== ownerId && Date.now() - held.releasedAt.getTime() < DOMAIN_HOLD_DAYS * DAY_MS) {
    throw new DomainClaimError("That domain is not available yet. Try again in a few days.");
  }

  const waiting = await db.merchant.count({
    where: {
      ownerId,
      domain: { not: null },
      domainVerifiedAt: null,
      ...(merchantId ? { id: { not: merchantId } } : {}),
    },
  });
  if (waiting >= MAX_UNVERIFIED_DOMAINS) {
    throw new DomainClaimError(`You have ${waiting} domains waiting to be verified. Verify one first.`);
  }

  if (held) await db.releasedDomain.delete({ where: { domain } });
  await db.merchant.updateMany({
    where: { domain, domainVerifiedAt: null, ownerId: { not: ownerId } },
    data: { domain: null, domainToken: null },
  });
  return { domainToken: randomBytes(16).toString("base64url"), domainVerifiedAt: null };
}

/**
 * Holds a proven domain a product is giving up, for the Owner giving it up.
 * Returns the write to run, so a delete can put it in its own transaction.
 */
export function releaseDomain(ownerId: string, domain: string, verifiedAt: Date | null) {
  if (!ownershipProofRequired() || !verifiedAt) return null;
  return db.releasedDomain.upsert({
    where: { domain },
    create: { domain, ownerId },
    update: { ownerId, releasedAt: new Date() },
  });
}

export type DomainOwnership = {
  domain: string;
  /** The record to create, or null once the domain is proven. */
  record: { name: string; value: string } | null;
  result: CheckResult;
};

/**
 * Where a product's domain proof stands, looking for the TXT record when it is
 * still missing and recording the proof once it is there. Null when proof is
 * not required, so the screens show nothing extra.
 */
export async function checkDomainOwnership(
  ownerId: string,
  merchantId: string,
  resolve: (hostname: string) => Promise<string[]> = resolveTxtAuthoritative
): Promise<DomainOwnership | null> {
  if (!ownershipProofRequired()) return null;
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { domain: true, domainToken: true, domainVerifiedAt: true },
  });
  // No domain: another Owner's claim took it, and there is nothing to prove.
  if (!merchant?.domain) return null;
  const { domain, domainToken, domainVerifiedAt } = merchant;
  if (domainVerifiedAt || !domainToken) {
    return { domain, record: null, result: { ok: true, detail: "Verified" } };
  }

  const record = ownershipRecord(domain, domainToken);
  let values: string[];
  try {
    values = await resolve(record.name);
  } catch {
    return { domain, record, result: { ok: false, detail: "No record found yet" } };
  }
  if (!values.some((value) => value.trim() === record.value)) {
    return {
      domain,
      record,
      result: { ok: false, detail: values.length ? "The record has a different value" : "No record found yet" },
    };
  }

  // Scoped to the token that was looked up, so a domain changed meanwhile is
  // not marked proven by the old one's record.
  await db.merchant.updateMany({
    where: { id: merchantId, ownerId, domain, domainToken },
    data: { domainVerifiedAt: new Date() },
  });
  return { domain, record: null, result: { ok: true, detail: "Verified" } };
}
