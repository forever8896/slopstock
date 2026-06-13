/**
 * AES-256-GCM encryption envelope for agent state snapshots.
 *
 * Design choices:
 * - Pure WebCrypto (built into Bun) — zero extra dependencies.
 * - Envelope shape mirrors Seal's structure so we can swap the key-wrap
 *   to Seal (Move PKE) later without re-architecting the storage layer.
 *   Seal envelope = { version, iv, ciphertext }. We add `version: 1` as
 *   a migration marker.
 * - 12-byte random IV per encryption (AES-GCM standard).
 * - Tag (authentication) is appended by WebCrypto to the ciphertext tail
 *   automatically (last 16 bytes).
 *
 * Key lifecycle:
 * - Operator holds the AES key (env var AGENT_SNAPSHOT_KEY, base64url).
 * - Per-agent keys can be derived: `deriveAgentKey(masterKey, tokenId)`.
 * - On agent acquisition, the key transfers with the asset — "sealed memory."
 */

export interface CryptoEnvelope {
  /** Always 1 for AES-256-GCM; bump for future algorithm changes. */
  version: 1;
  /** 12-byte random IV (nonce). */
  iv: Uint8Array;
  /** AES-GCM ciphertext + 16-byte authentication tag (appended by WebCrypto). */
  ciphertext: Uint8Array;
}

const ALGORITHM = "AES-GCM";
const KEY_LENGTH = 256;

/** Generate a fresh AES-256 key. */
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    { name: ALGORITHM, length: KEY_LENGTH },
    true, // extractable — so we can export/store the key
    ["encrypt", "decrypt"],
  );
}

/** Export a CryptoKey to raw bytes (32 bytes for AES-256). */
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);
  return new Uint8Array(raw);
}

/** Import raw bytes (32 bytes) as an AES-256-GCM key. */
export async function importKey(raw: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength) as ArrayBuffer,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}

/** Import a base64url-encoded key string (from env var). */
export async function importKeyFromBase64(b64: string): Promise<CryptoKey> {
  const raw = Uint8Array.from(atob(b64.replace(/-/g, "+").replace(/_/g, "/")), (c) =>
    c.charCodeAt(0),
  );
  return importKey(raw);
}

/** Export a key to base64url string (for env var storage). */
export async function exportKeyToBase64(key: CryptoKey): Promise<string> {
  const raw = await exportKey(key);
  return btoa(String.fromCharCode(...raw))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Encrypt plaintext bytes into a CryptoEnvelope.
 * Each call generates a fresh random 12-byte IV.
 */
export async function encrypt(key: CryptoKey, plaintext: Uint8Array): Promise<CryptoEnvelope> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ivBuf = iv.buffer.slice(0, 12) as ArrayBuffer;
  const plaintextBuf = plaintext.buffer.slice(
    plaintext.byteOffset,
    plaintext.byteOffset + plaintext.byteLength,
  ) as ArrayBuffer;
  const cipherBuf = await crypto.subtle.encrypt({ name: ALGORITHM, iv: ivBuf }, key, plaintextBuf);
  return {
    version: 1,
    iv,
    ciphertext: new Uint8Array(cipherBuf),
  };
}

/**
 * Decrypt a CryptoEnvelope back to plaintext bytes.
 * Throws DOMException if the key is wrong or the data is tampered.
 */
export async function decrypt(key: CryptoKey, envelope: CryptoEnvelope): Promise<Uint8Array> {
  const ciphertextBuf = envelope.ciphertext.buffer.slice(
    envelope.ciphertext.byteOffset,
    envelope.ciphertext.byteOffset + envelope.ciphertext.byteLength,
  ) as ArrayBuffer;
  const ivBuf = envelope.iv.buffer.slice(
    envelope.iv.byteOffset,
    envelope.iv.byteOffset + envelope.iv.byteLength,
  ) as ArrayBuffer;
  const plainBuf = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: ivBuf },
    key,
    ciphertextBuf,
  );
  return new Uint8Array(plainBuf);
}

/**
 * Serialize a CryptoEnvelope to bytes for Walrus storage.
 * Layout: [4 bytes: version LE] [12 bytes: iv] [rest: ciphertext]
 */
export function serializeEnvelope(envelope: CryptoEnvelope): Uint8Array {
  const out = new Uint8Array(4 + 12 + envelope.ciphertext.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, envelope.version, true); // LE
  out.set(envelope.iv, 4);
  out.set(envelope.ciphertext, 16);
  return out;
}

/**
 * Deserialize bytes (from Walrus) back into a CryptoEnvelope.
 */
export function deserializeEnvelope(bytes: Uint8Array): CryptoEnvelope {
  if (bytes.length < 16) throw new Error("crypto: envelope too short");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(0, true) as 1;
  const iv = bytes.slice(4, 16);
  const ciphertext = bytes.slice(16);
  return { version, iv, ciphertext };
}

/**
 * Derive a per-agent key from a master key using HKDF.
 * The tokenId is the "info" material — different agents get different keys.
 */
export async function deriveAgentKey(masterKey: CryptoKey, tokenId: bigint): Promise<CryptoKey> {
  // Export master key material first
  const masterRaw = await exportKey(masterKey);

  // Import as HKDF key
  const hkdfKey = await crypto.subtle.importKey(
    "raw",
    masterRaw.buffer.slice(masterRaw.byteOffset, masterRaw.byteOffset + masterRaw.byteLength) as ArrayBuffer,
    { name: "HKDF" },
    false,
    ["deriveKey"],
  );

  // Derive AES-256-GCM key with tokenId as info
  const info = new TextEncoder().encode(`stratum/agent/${tokenId.toString()}`);
  const salt = new Uint8Array(32); // zero salt (deterministic)

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt, info },
    hkdfKey,
    { name: ALGORITHM, length: KEY_LENGTH },
    true,
    ["encrypt", "decrypt"],
  );
}
