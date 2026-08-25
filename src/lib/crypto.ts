import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

// AES-256-GCM, keyed by MASTER_ENCRYPTION_KEY (ADR 0003). Used for every
// Merchant-supplied credential stored in the database: Stripe secret key,
// Stripe webhook signing secret, email provider config. The key itself
// lives only in the environment, never in the database — losing it makes
// every encrypted credential on this Instance unrecoverable (documented
// in CONTEXT.md, this is a known, accepted trade-off).

function getKey(): Buffer {
  const key = process.env.MASTER_ENCRYPTION_KEY;
  if (!key || key.length !== 64) {
    throw new Error(
      "MASTER_ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)"
    );
  }
  return Buffer.from(key, "hex");
}

export function encrypt(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv, authTag, encrypted].map((b) => b.toString("hex")).join(":");
}

export function decrypt(ciphertext: string): string {
  const [ivHex, authTagHex, encryptedHex] = ciphertext.split(":");
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
  const decrypted = Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final(),
  ]);
  return decrypted.toString("utf8");
}
