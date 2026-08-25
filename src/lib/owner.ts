import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

export async function ownerExists(): Promise<boolean> {
  const count = await db.owner.count();
  return count > 0;
}

export async function createOwner(
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  return db.$transaction(async (tx) => {
    // Advisory lock scoped to this transaction, released automatically on
    // commit/rollback. Serializes concurrent createOwner calls so the
    // existence check and the insert are atomic together — a fixed
    // arbitrary lock key is fine here, this function only ever guards one
    // thing (the single-Owner invariant).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(72583)`;

    const count = await tx.owner.count();
    if (count > 0) {
      throw new Error("An Owner already exists on this Instance");
    }

    const passwordHash = await hashPassword(password);
    return tx.owner.create({
      data: { email, passwordHash },
      select: { id: true, email: true },
    });
  });
}

export async function verifyOwnerCredentials(
  email: string,
  password: string
): Promise<{ id: string; email: string } | null> {
  const owner = await db.owner.findUnique({ where: { email } });
  if (!owner) return null;
  const valid = await verifyPassword(password, owner.passwordHash);
  if (!valid) return null;
  return { id: owner.id, email: owner.email };
}
