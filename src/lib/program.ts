import { db } from "@/lib/db";
import type { CommissionDurationType } from "@prisma/client";
import { uniqueSlug } from "@/lib/slug";

export type ProgramInput = {
  name: string;
  defaultCommissionRate: number;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
};

async function assertMerchantOwnership(ownerId: string, merchantId: string): Promise<void> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) {
    throw new Error("Merchant not found");
  }
}

export async function createProgram(
  ownerId: string,
  merchantId: string,
  input: ProgramInput
): Promise<{ id: string; slug: string }> {
  await assertMerchantOwnership(ownerId, merchantId);

  const slug = await uniqueSlug(input.name, "program", async (candidate) =>
    Boolean(
      await db.program.findFirst({
        where: { merchantId, slug: candidate },
        select: { id: true },
      })
    )
  );

  return db.program.create({
    data: { merchantId, slug, ...input },
    select: { id: true, slug: true },
  });
}

export async function listProgramsForMerchant(
  ownerId: string,
  merchantId: string
): Promise<{ id: string; slug: string; name: string; defaultCommissionRate: unknown }[]> {
  await assertMerchantOwnership(ownerId, merchantId);

  return db.program.findMany({
    where: { merchantId },
    select: { id: true, slug: true, name: true, defaultCommissionRate: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getProgramForMerchant(
  ownerId: string,
  merchantId: string,
  programSlug: string
): Promise<{
  id: string;
  slug: string;
  name: string;
  defaultCommissionRate: unknown;
  commissionDurationType: CommissionDurationType;
  commissionDurationMonths: number | null;
  attributionWindowDays: number;
  holdingPeriodDays: number;
} | null> {
  const merchant = await db.merchant.findFirst({
    where: { id: merchantId, ownerId },
    select: { id: true },
  });
  if (!merchant) return null;

  return db.program.findFirst({
    where: { slug: programSlug, merchantId },
    select: {
      id: true,
      slug: true,
      name: true,
      defaultCommissionRate: true,
      commissionDurationType: true,
      commissionDurationMonths: true,
      attributionWindowDays: true,
      holdingPeriodDays: true,
    },
  });
}

export async function updateProgram(
  ownerId: string,
  merchantId: string,
  programId: string,
  input: ProgramInput
): Promise<void> {
  await assertMerchantOwnership(ownerId, merchantId);

  const existing = await db.program.findFirst({
    where: { id: programId, merchantId },
    select: { id: true },
  });
  if (!existing) {
    throw new Error("Program not found");
  }

  await db.program.update({
    where: { id: programId },
    data: { ...input },
  });
}

// Public — no Owner/session context. Scoped only by merchantId (resolved
// from the request's Host header by the caller), not by ownership, since
// this backs the public signup page.
//
// Looked up by slug: this is the one Program identifier that appears in a
// link sent to a stranger, and a cuid there reads like a tracking id.
export async function getProgramForSignup(
  merchantId: string,
  programSlug: string
): Promise<{ id: string; name: string } | null> {
  return db.program.findFirst({
    where: { slug: programSlug, merchantId },
    select: { id: true, name: true },
  });
}
