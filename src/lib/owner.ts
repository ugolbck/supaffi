import { db } from "@/lib/db";
import { ConcurrencyLimitError, hashPassword, verifyAgainstNoAccount, verifyPassword } from "@/lib/password";
import { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

// Lives in its own module so the startup hook can reach it without dragging
// Argon2 into the Edge instrumentation bundle. Re-exported here so every
// other caller keeps importing it from the same place as before.
export { ownerExists } from "@/lib/ownerExists";

// Re-exported so callers that already reach this module keep one import. The
// constant itself lives in a leaf module the setup screen can import without
// dragging Prisma and Argon2 into a client bundle.
export { MIN_PASSWORD_LENGTH } from "@/lib/passwordPolicy";

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

type OwnerForLogin = { id: string; email: string; passwordHash: string };

/**
 * The Owner row for a login attempt, without checking the password.
 *
 * Split from the check so the login throttle can count an attempt on the real
 * Owner's email before the hash runs, and ignore every other email.
 */
export async function findOwnerForLogin(email: string): Promise<OwnerForLogin | null> {
  return db.owner.findUnique({
    where: { email: email.trim().toLowerCase() },
    select: { id: true, email: true, passwordHash: true },
  });
}

/**
 * Checks a password against the Owner found for the attempt.
 *
 * With no Owner, it still runs a full verify against a dummy hash and then
 * refuses. Returning straight away would make a wrong email answer in
 * milliseconds and the right one in a tenth of a second, which tells a
 * stranger the Owner's email without them ever guessing a password.
 *
 * When the Argon2 queue is full (see password.ts) it refuses without hashing,
 * for the right email and a wrong one alike, so the answer is the same
 * "incorrect" a failed guess gets rather than an error page.
 */
export async function checkOwnerPassword(
  owner: OwnerForLogin | null,
  password: string
): Promise<{ id: string; email: string } | null> {
  try {
    if (!owner) {
      await verifyAgainstNoAccount(password);
      return null;
    }
    const valid = await verifyPassword(password, owner.passwordHash);
    if (!valid) return null;
    return { id: owner.id, email: owner.email };
  } catch (err) {
    if (err instanceof ConcurrencyLimitError) return null;
    throw err;
  }
}

export async function verifyOwnerCredentials(
  email: string,
  password: string
): Promise<{ id: string; email: string } | null> {
  return checkOwnerPassword(await findOwnerForLogin(email), password);
}

async function ownerWithVerifiedPassword(
  ownerId: string,
  currentPassword: string
): Promise<{ id: string } | { error: string }> {
  const owner = await db.owner.findUnique({
    where: { id: ownerId },
    select: { id: true, passwordHash: true },
  });
  if (!owner) return { error: "Account not found" };
  const ok = await verifyPassword(currentPassword, owner.passwordHash);
  if (!ok) return { error: "That password is not right" };
  return { id: owner.id };
}

export async function changeOwnerEmail(
  ownerId: string,
  currentPassword: string,
  newEmail: string
): Promise<{ error: string } | null> {
  const email = newEmail.trim().toLowerCase();
  if (!email.includes("@")) return { error: "That does not look like an email address" };
  const owner = await ownerWithVerifiedPassword(ownerId, currentPassword);
  if ("error" in owner) return owner;
  await db.owner.update({ where: { id: owner.id }, data: { email } });
  return null;
}

export async function changeOwnerPassword(
  ownerId: string,
  currentPassword: string,
  newPassword: string
): Promise<{ error: string } | null> {
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return { error: `Use at least ${MIN_PASSWORD_LENGTH} characters` };
  }
  const owner = await ownerWithVerifiedPassword(ownerId, currentPassword);
  if ("error" in owner) return owner;
  await db.owner.update({
    where: { id: owner.id },
    // The stamp goes down in the same update as the hash: every session
    // issued before this moment stops working (see ownerSessionIsCurrent).
    data: { passwordHash: await hashPassword(newPassword), passwordChangedAt: new Date() },
  });
  return null;
}
