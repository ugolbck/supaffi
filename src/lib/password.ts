import { hash, verify } from "@node-rs/argon2";

// OWASP 2026 baseline for Argon2id: 64MB memory, 3 iterations, 4 parallel
// lanes. Tune up from here if the Instance's hardware can absorb more —
// this is a floor, not a ceiling.
const ARGON2_OPTIONS = {
  memoryCost: 65536, // 64 MiB, in KiB
  timeCost: 3,
  parallelism: 4,
};

export async function hashPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(plain: string, hashed: string): Promise<boolean> {
  return verify(hashed, plain);
}
