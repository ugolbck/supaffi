import { createHmac, randomBytes } from "node:crypto";

/** A secret as Polar generates one since 2026-09-08: whsec_ and 32 random bytes in base64. */
export function polarSecret(): string {
  return `whsec_${randomBytes(32).toString("base64")}`;
}

/** Headers signing `body` the way Polar's Standard Webhooks signer does. */
export function polarHeaders(
  body: string,
  secret: string,
  opts: { id?: string; at?: number; legacy?: boolean } = {}
): Headers {
  const id = opts.id ?? `evt_${crypto.randomUUID()}`;
  const timestamp = String(Math.floor((opts.at ?? Date.now()) / 1000));
  const key = opts.legacy ? Buffer.from(secret, "utf8") : Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signature = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return new Headers({ "webhook-id": id, "webhook-timestamp": timestamp, "webhook-signature": `v1,${signature}` });
}
