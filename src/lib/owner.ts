import { db } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/password";

// Lives in its own module so the startup hook can reach it without dragging
// Argon2 into the Edge instrumentation bundle. Re-exported here so every
// other caller keeps importing it from the same place as before.
export { ownerExists } from "@/lib/ownerExists";

export async function createOwner(
  email: string,
  password: string
): Promise<{ id: string; email: string }> {
  const normalizedEmail = email.trim().toLowerCase();
  // Hashed before the transaction starts: Argon2 (~100ms) has no business
  // running while the advisory lock and a pooled connection are held.
  const passwordHash = await hashPassword(password);

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

    return tx.owner.create({
      data: { email: normalizedEmail, passwordHash },
      select: { id: true, email: true },
    });
  });
}

export async function verifyOwnerCredentials(
  email: string,
  password: string
): Promise<{ id: string; email: string } | null> {
  const normalizedEmail = email.trim().toLowerCase();
  const owner = await db.owner.findUnique({ where: { email: normalizedEmail } });
  if (!owner) return null;
  const valid = await verifyPassword(password, owner.passwordHash);
  if (!valid) return null;
  return { id: owner.id, email: owner.email };
}
