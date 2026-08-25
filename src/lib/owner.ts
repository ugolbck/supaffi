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
  if (await ownerExists()) {
    throw new Error("An Owner already exists on this Instance");
  }
  const passwordHash = await hashPassword(password);
  const owner = await db.owner.create({
    data: { email, passwordHash },
    select: { id: true, email: true },
  });
  return owner;
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
