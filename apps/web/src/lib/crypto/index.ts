/**
 * AES-256-GCM encryption for user API keys at rest. Server only (node:crypto).
 * Key: UNFOLD_ENCRYPTION_KEY = 32 bytes as 64 hex chars (`openssl rand -hex 32`).
 */
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

export type Sealed = { ciphertext: string; iv: string; tag: string }; // base64 fields

let devKey: Buffer | null = null;

export function isEncryptionConfigured(): boolean {
  return /^[0-9a-fA-F]{64}$/.test(process.env.UNFOLD_ENCRYPTION_KEY ?? "");
}

function getKey(): Buffer {
  const hex = process.env.UNFOLD_ENCRYPTION_KEY ?? "";
  if (/^[0-9a-fA-F]{64}$/.test(hex)) return Buffer.from(hex, "hex");
  if (hex) throw new Error("UNFOLD_ENCRYPTION_KEY must be 64 hex characters (32 bytes).");
  if (process.env.NODE_ENV !== "production" && process.env.UNFOLD_DEV_NO_AUTH === "1") {
    // Dev bypass only: ephemeral per-process key, so the in-memory key store still works.
    devKey ??= randomBytes(32);
    return devKey;
  }
  throw new Error("UNFOLD_ENCRYPTION_KEY is not set.");
}

export function encrypt(plaintext: string): Sealed {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

export function decrypt({ ciphertext, iv, tag }: Sealed): string {
  const decipher = createDecipheriv("aes-256-gcm", getKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
}
