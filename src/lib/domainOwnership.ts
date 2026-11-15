import { randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
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

type Tx = Prisma.TransactionClient;

export function ownershipProofRequired(): boolean {
  return staticExt.domains.requireOwnershipProof;
}

/**
 * The lookup every request on a product's domain goes through, for findFirst.
 * With proof required, a domain not proven yet matches no product, so it is
 * not served and Caddy is refused a certificate for it, while the proven
 * domain a product is moving away from is served until the new one is proven.
 */
export function servedDomain(domain: string): Prisma.MerchantWhereInput {
  if (!ownershipProofRequired()) return { domain };
  return { OR: [{ domain, domainVerifiedAt: { not: null } }, { previousDomain: domain }] };
}

/** The TXT record that proves a domain: where it goes and what it says. */
export function ownershipRecord(domain: string, token: string): { name: string; value: string } {
  return { name: `_supaffi.${domain}`, value: `supaffi-verification=${token}` };
}

/** Thrown by product writes when the domain cannot be claimed. The message is for the Owner. */
export class DomainClaimError extends Error {}

const newToken = () => randomBytes(16).toString("base64url");

/**
 * Refuses a domain this Owner cannot take, and returns what a product taking
 * it stores. Runs inside the transaction that writes the product, with this
 * Owner's row locked, so two saves at once cannot both slip under the cap.
 * Called for a new product and for a product's domain change, never for a
 * save that keeps the domain. `merchantId` is the product being changed, left
 * out of the count of domains waiting for proof.
 *
 * An unproven claim blocks nobody: another Owner's product waiting on the same
 * domain loses it here (falling back to the proven domain it was moving away
 * from, if any), so whoever proves it first keeps it. A proven domain, or one
 * this Owner's own product holds, is left alone and the write that follows is
 * refused as a duplicate.
 */
export async function claimDomain(
  tx: Tx,
  ownerId: string,
  domain: string,
  merchantId?: string
): Promise<{ domainToken: string | null; domainVerifiedAt: Date | null }> {
  // Off, or a machine nothing outside can reach: live at once, as always.
  if (!ownershipProofRequired() || isLocalDomain(domain)) {
    return { domainToken: null, domainVerifiedAt: new Date() };
  }

  await tx.$queryRaw`SELECT "id" FROM "Owner" WHERE "id" = ${ownerId} FOR UPDATE`;

  // Still served for the product moving away from it, so as proven as any.
  if (await tx.merchant.findFirst({ where: { previousDomain: domain }, select: { id: true } })) {
    throw new DomainClaimError("Another product already uses that domain.");
  }

  const held = await tx.releasedDomain.findUnique({ where: { domain } });
  if (held && held.ownerId !== ownerId && Date.now() - held.releasedAt.getTime() < DOMAIN_HOLD_DAYS * DAY_MS) {
    throw new DomainClaimError("That domain is not available yet. Try again in a few days.");
  }

  const waiting = await tx.merchant.count({
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

  if (held) await tx.releasedDomain.delete({ where: { domain } });
  const loser = await tx.merchant.findFirst({
    where: { domain, domainVerifiedAt: null, ownerId: { not: ownerId } },
    select: { id: true, previousDomain: true },
  });
  if (loser) {
    await tx.merchant.update({
      where: { id: loser.id },
      data: loser.previousDomain
        ? { domain: loser.previousDomain, previousDomain: null, domainToken: null, domainVerifiedAt: new Date() }
        : { domain: null, domainToken: null },
    });
  }
  return { domainToken: newToken(), domainVerifiedAt: null };
}

/**
 * Holds a proven domain a product stopped serving, for the Owner who gave it
 * up. The caller passes only domains that were proven and served.
 */
export async function releaseDomain(tx: Tx, ownerId: string, domain: string): Promise<void> {
  if (!ownershipProofRequired()) return;
  await tx.releasedDomain.upsert({
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
  /** True on the check that proved a domain the product moved to, retiring the one it served before. */
  moved: boolean;
};

/**
 * Where a product's domain proof stands, looking for the TXT record when it is
 * still missing and recording the proof once it is there. Proof also retires
 * the proven domain the product was moving away from. Null when proof is not
 * required, so the screens show nothing extra.
 */
export async function checkDomainOwnership(
  ownerId: string,
  merchantId: string,
  resolve: (hostname: string) => Promise<string[]> = resolveTxtAuthoritative
): Promise<DomainOwnership | null> {
  if (!ownershipProofRequired()) return null;
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { domain: true, domainToken: true, domainVerifiedAt: true, previousDomain: true },
  });
  // No domain: another Owner's claim took it, and there is nothing to prove.
  if (!merchant?.domain) return null;
  const { domain, domainVerifiedAt, previousDomain } = merchant;
  if (domainVerifiedAt) return { domain, record: null, result: { ok: true, detail: "Verified" }, moved: false };

  let domainToken = merchant.domainToken;
  if (!domainToken) {
    domainToken = newToken();
    await db.merchant.updateMany({
      where: { id: merchantId, ownerId, domain, domainToken: null },
      data: { domainToken },
    });
  }

  const record = ownershipRecord(domain, domainToken);
  const waiting = (detail: string): DomainOwnership => ({ domain, record, result: { ok: false, detail }, moved: false });
  let values: string[];
  try {
    values = await resolve(record.name);
  } catch {
    return waiting("No record found yet");
  }
  if (!values.some((value) => value.trim() === record.value)) {
    return waiting(values.length ? "The record has a different value" : "No record found yet");
  }

  // Scoped to the token that was looked up, so a domain changed meanwhile is
  // not marked proven by the old one's record.
  const proven = await db.$transaction(async (tx) => {
    const { count } = await tx.merchant.updateMany({
      where: { id: merchantId, ownerId, domain, domainToken, domainVerifiedAt: null },
      data: { domainVerifiedAt: new Date(), previousDomain: null },
    });
    if (count === 1 && previousDomain) await releaseDomain(tx, ownerId, previousDomain);
    return count === 1;
  });
  if (!proven) return waiting("No record found yet");
  return { domain, record: null, result: { ok: true, detail: "Verified" }, moved: Boolean(previousDomain) };
}
