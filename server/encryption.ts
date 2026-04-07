import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";

// Encryption key must be a 64-char hex string (32 bytes)
// In production, set ENCRYPTION_KEY env var to a stable value generated with:
//   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
let ENCRYPTION_KEY: string;

if (process.env.ENCRYPTION_KEY) {
  if (process.env.ENCRYPTION_KEY.length !== 64) {
    console.warn(
      `[security] ENCRYPTION_KEY is ${process.env.ENCRYPTION_KEY.length} chars (expected 64). Using fallback random key.`
    );
    ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  } else {
    ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
  }
} else {
  // Generate a random key for this process — keys stored with this key won't
  // survive restarts, but existing plaintext keys will still be read correctly
  // via the legacy fallback in decryptApiKey.
  ENCRYPTION_KEY = crypto.randomBytes(32).toString("hex");
  console.warn(
    "[security] WARNING: ENCRYPTION_KEY env var is not set. " +
    "A random key is being used — encrypted API keys will be lost on restart. " +
    "Set ENCRYPTION_KEY in your environment for production use."
  );
}

/**
 * Encrypt a plaintext API key using AES-256-GCM.
 * Returns a string in the form: <iv_hex>:<authTag_hex>:<ciphertext_hex>
 */
export function encryptApiKey(plaintext: string): string {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY, "hex"), iv);
  let encrypted = cipher.update(plaintext, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return iv.toString("hex") + ":" + authTag + ":" + encrypted;
}

/**
 * Decrypt an AES-256-GCM encrypted API key.
 * If the input doesn't look like an encrypted value (no colons / wrong part count),
 * it is returned as-is so that legacy plaintext keys stored before encryption was
 * introduced continue to work.
 */
export function decryptApiKey(ciphertext: string): string {
  const parts = ciphertext.split(":");
  if (parts.length !== 3) {
    // Legacy plaintext — return as-is
    return ciphertext;
  }
  const [ivHex, authTagHex, encrypted] = parts;
  try {
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      Buffer.from(ENCRYPTION_KEY, "hex"),
      Buffer.from(ivHex, "hex")
    );
    decipher.setAuthTag(Buffer.from(authTagHex, "hex"));
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    return decrypted;
  } catch {
    // Decryption failed (e.g. wrong key, corrupted data) — return as-is
    // to avoid crashing; the LLM call will simply fail with a bad key error
    console.warn("[security] decryptApiKey: decryption failed, returning ciphertext as-is");
    return ciphertext;
  }
}
