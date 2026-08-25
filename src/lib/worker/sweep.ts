import { db } from "@/lib/db";

// Runs on the same tick as the webhook drain — zero new infrastructure.
// Deliberately WHERE status = 'PENDING' only: FLAGGED commissions are
// excluded on purpose, a flag blocks progress to PAYABLE until a Merchant
// confirms or dismisses it (that confirm/dismiss action, built elsewhere,
// is what flips a row away from FLAGGED so this sweep can then pick it up).
export async function sweepPayableCommissions(): Promise<number> {
  return db.$executeRaw`
    UPDATE "Commission"
    SET status = 'PAYABLE'
    WHERE status = 'PENDING'
      AND "payableAt" <= now();
  `;
}
