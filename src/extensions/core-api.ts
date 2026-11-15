import { db } from "@/lib/db";
import { auth, signIn } from "@/lib/auth";
import { createOwner, looksLikeOwnerEmail, MIN_PASSWORD_LENGTH } from "@/lib/owner";
import { hashPassword } from "@/lib/password";
import { listMerchantsForOwner } from "@/lib/merchant";
import { isMerchantDomain as hostIsMerchantDomain } from "@/lib/merchantDomain";

// What a build that extends this app may call. Everything else under src/lib
// is internal and can change in any release; these keep their signatures
// unless EXTENSIONS_API_VERSION moves.

// Checked here as well as in any form in front of it, so no caller can skip it.
function assertPassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) throw new Error(`Passwords need at least ${MIN_PASSWORD_LENGTH} characters`);
}

/**
 * Creates an Owner. Throws on a malformed email or short password, when the
 * email is taken, or when Owner signup is closed and an Owner exists.
 *
 * It does neither of two things a public form in front of it needs: it does
 * not rate-limit, and every call runs a full Argon2 hash, so an unthrottled
 * caller is a way to exhaust CPU and memory; and it does not check that the
 * person owns the email. Both are the caller's job.
 */
export async function createOwnerAccount(input: { email: string; password: string }): Promise<{ ownerId: string }> {
  if (!looksLikeOwnerEmail(input.email)) throw new Error("That email does not look right");
  assertPassword(input.password);
  const owner = await createOwner(input.email, input.password);
  return { ownerId: owner.id };
}

export async function findOwnerByEmail(email: string): Promise<{ ownerId: string } | null> {
  const owner = await db.owner.findUnique({ where: { email: email.trim().toLowerCase() }, select: { id: true } });
  return owner && { ownerId: owner.id };
}

/** Sets a new password without the old one, and ends every session issued before it. */
export async function setOwnerPassword(ownerId: string, password: string): Promise<void> {
  assertPassword(password);
  await db.owner.update({
    where: { id: ownerId },
    // Compared in milliseconds against when each session signed in (see
    // ownerSessionIsCurrent).
    data: { passwordHash: await hashPassword(password), passwordChangedAt: new Date() },
  });
}

export async function listOwnerMerchants(ownerId: string): Promise<{ id: string; name: string; domain: string }[]> {
  const merchants = await listMerchantsForOwner(ownerId);
  return merchants.map(({ id, name, domain }) => ({ id, name, domain }));
}

/** The signed-in Owner's id, or null for no session or an affiliate's. */
export async function currentOwnerId(): Promise<string | null> {
  const session = await auth();
  return session?.user?.role === "owner" && session.user.id ? session.user.id : null;
}

/** Signs an Owner in and redirects. Throws Auth.js's redirect on success, like signIn itself. */
export async function signInOwner(input: { email: string; password: string; redirectTo: string }): Promise<void> {
  await signIn("credentials", input);
}

/** Whether a request's host is one of the products' affiliate domains rather than the dashboard's. */
export async function isMerchantDomain(host: string | null): Promise<boolean> {
  return hostIsMerchantDomain(host);
}
