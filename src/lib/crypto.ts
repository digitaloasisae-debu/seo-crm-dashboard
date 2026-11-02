import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM. Ciphertext is stored as base64(ciphertext || 16-byte auth tag).
// Keys come only from env: ENCRYPTION_KEY (current) and ENCRYPTION_KEY_<n> (older versions).

const ALGO = "aes-256-gcm";
const TAG_BYTES = 16;

function currentVersion(): number {
  return Number(process.env.ENCRYPTION_KEY_VERSION || 1);
}

function keyFor(version: number): Buffer {
  const raw =
    version === currentVersion()
      ? process.env.ENCRYPTION_KEY
      : process.env[`ENCRYPTION_KEY_${version}`];
  if (!raw) throw new Error(`Encryption key for version ${version} is not configured`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error("Encryption key must be 32 bytes, base64-encoded");
  return key;
}

export type Sealed = { secretEncrypted: string; iv: string; keyVersion: number };

export function encryptSecret(plaintext: string): Sealed {
  const keyVersion = currentVersion();
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyFor(keyVersion), iv);
  const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    secretEncrypted: Buffer.concat([enc, cipher.getAuthTag()]).toString("base64"),
    iv: iv.toString("base64"),
    keyVersion,
  };
}

export function decryptSecret(sealed: Sealed): string {
  const buf = Buffer.from(sealed.secretEncrypted, "base64");
  const decipher = createDecipheriv(ALGO, keyFor(sealed.keyVersion), Buffer.from(sealed.iv, "base64"));
  decipher.setAuthTag(buf.subarray(buf.length - TAG_BYTES));
  return Buffer.concat([decipher.update(buf.subarray(0, buf.length - TAG_BYTES)), decipher.final()]).toString("utf8");
}
