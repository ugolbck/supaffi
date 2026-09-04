import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

// Gates the setup wizard, which creates the Owner account and therefore has
// no credential of its own to check. Without this, whoever reaches a fresh
// Instance first becomes its Owner, and with it custody of every Merchant's
// encrypted Stripe credentials. Portainer shipped this exact shape as
// CVE-2026-55761; this is their fix.
//
// Held in memory for the life of the server process and never persisted. The
// delivery channel is the log stream, so the only person who can read it is
// someone who already has the box. A restart mints a new one, which also
// gives an operator who lost theirs a way to get another.
//
// Same globalThis pattern as the worker's start guard in instrumentation.ts
// and the Prisma client in db.ts: survives dev-mode module reloads, which
// would otherwise silently invalidate a token the operator is mid-way
// through typing.
//
// Per process, which is per instance for the single-container stack this
// ships as. Run several app replicas behind a load balancer and each one mints
// its own token while none of them can verify another's, so a correct paste
// lands on the wrong replica and is rejected at random. Scaling this stack
// horizontally means moving the token to somewhere all replicas share.
const globalForSetupToken = globalThis as unknown as {
  supaffiSetupToken?: string;
};

export function mintSetupToken(): string {
  // 24 bytes is 192 bits, base64url-encoded to 32 characters with no
  // padding and nothing that needs escaping in a form field or a log line.
  const token = randomBytes(24).toString("base64url");
  globalForSetupToken.supaffiSetupToken = token;
  return token;
}

export function setupTokenExists(): boolean {
  return typeof globalForSetupToken.supaffiSetupToken === "string";
}

export function verifySetupToken(candidate: string): boolean {
  const expected = globalForSetupToken.supaffiSetupToken;
  // Fails closed. No token held means there is nothing a caller could
  // legitimately present, so every candidate is wrong.
  if (!expected) return false;
  // Compared over fixed-width digests rather than the raw strings:
  // timingSafeEqual throws outright on a length mismatch, and catching that
  // to return false would leak the expected length through the difference
  // between the two code paths. Hashing makes both sides 32 bytes whatever
  // was submitted.
  return timingSafeEqual(sha256(candidate), sha256(expected));
}

export function clearSetupToken(): void {
  delete globalForSetupToken.supaffiSetupToken;
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}
