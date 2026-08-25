import { db } from "@/lib/db";
import type { CommissionDurationType } from "@prisma/client";

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
): Promise<{ id: string }> {
  await assertMerchantOwnership(ownerId, merchantId);

  return db.program.create({
    data: { merchantId, ...input },
    select: { id: true },
  });
}

export async function listProgramsForMerchant(
  ownerId: string,
  merchantId: string
): Promise<{ id: string; name: string; defaultCommissionRate: unknown }[]> {
  await assertMerchantOwnership(ownerId, merchantId);

  return db.program.findMany({
    where: { merchantId },
    select: { id: true, name: true, defaultCommissionRate: true },
    orderBy: { createdAt: "asc" },
  });
}

export async function getProgramForMerchant(
  ownerId: string,
  merchantId: string,
  programId: string
): Promise<{
  id: string;
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
    where: { id: programId, merchantId },
    select: {
      id: true,
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
