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
  const token = base64url(crypto.getRandomValues(new Uint8Array(24)));
  globalForSetupToken.supaffiSetupToken = token;
  return token;
}

export function setupTokenExists(): boolean {
  return typeof globalForSetupToken.supaffiSetupToken === "string";
}

export async function verifySetupToken(candidate: string): Promise<boolean> {
  const expected = globalForSetupToken.supaffiSetupToken;
  // Fails closed. No token held means there is nothing a caller could
  // legitimately present, so every candidate is wrong.
  if (!expected) return false;
  // Compared over fixed-width digests rather than the raw strings, so a wrong
  // length costs exactly the same work as a wrong character and the expected
  // length is not leaked by the difference between two code paths. Both sides
  // are always the 32 bytes SHA-256 returns.
  const [a, b] = await Promise.all([sha256(candidate), sha256(expected)]);
  return equalFixedWidth(a, b);
}

export function clearSetupToken(): void {
  delete globalForSetupToken.supaffiSetupToken;
}

async function sha256(value: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return new Uint8Array(digest);
}

/**
 * Constant time for equal-length inputs: every byte is compared and the
 * result is only read at the end, so there is no early return to time.
 */
function equalFixedWidth(a: Uint8Array, b: Uint8Array): boolean {
  let difference = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) difference |= a[i] ^ b[i];
  return difference === 0;
}

/** Base64url without padding, and without Buffer, which Edge does not have. */
function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
