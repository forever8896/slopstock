/**
 * Unit tests for AES-256-GCM envelope (crypto.ts).
 *
 * No network access — pure WebCrypto, runs offline.
 * Tests:
 *   1. encrypt → decrypt identity (arbitrary bytes survive round-trip)
 *   2. ciphertext ≠ plaintext (encryption actually transforms the data)
 *   3. wrong key fails to decrypt (throws)
 *   4. envelope shape matches Seal's expected structure (for future migration)
 */

import { describe, expect, test } from "bun:test";
import {
  generateKey,
  exportKey,
  importKey,
  encrypt,
  decrypt,
} from "./crypto.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

describe("AES-256-GCM envelope", () => {
  test("encrypt → decrypt identity: bytes survive round-trip", async () => {
    const key = await generateKey();
    const plaintext = enc.encode("Hello, Walrus! This is agent memory.");
    const envelope = await encrypt(key, plaintext);
    const recovered = await decrypt(key, envelope);
    expect(Buffer.compare(Buffer.from(plaintext), Buffer.from(recovered))).toBe(0);
  });

  test("encrypt → decrypt identity: arbitrary binary bytes", async () => {
    const key = await generateKey();
    const plaintext = new Uint8Array(512);
    for (let i = 0; i < plaintext.length; i++) plaintext[i] = (i * 251 + 7) & 0xff;
    const envelope = await encrypt(key, plaintext);
    const recovered = await decrypt(key, envelope);
    expect(Buffer.compare(Buffer.from(plaintext), Buffer.from(recovered))).toBe(0);
  });

  test("ciphertext ≠ plaintext", async () => {
    const key = await generateKey();
    const plaintext = enc.encode("very secret agent memory content");
    const envelope = await encrypt(key, plaintext);
    // The encrypted blob should differ from the plaintext
    expect(Buffer.compare(Buffer.from(plaintext), Buffer.from(envelope.ciphertext))).not.toBe(0);
  });

  test("wrong key throws on decrypt", async () => {
    const key1 = await generateKey();
    const key2 = await generateKey();
    const plaintext = enc.encode("secret");
    const envelope = await encrypt(key1, plaintext);
    await expect(decrypt(key2, envelope)).rejects.toThrow();
  });

  test("envelope has expected Seal-compatible shape", async () => {
    const key = await generateKey();
    const plaintext = enc.encode("test");
    const envelope = await encrypt(key, plaintext);
    // Must have iv (12 bytes for AES-GCM nonce)
    expect(envelope.iv).toBeInstanceOf(Uint8Array);
    expect(envelope.iv.length).toBe(12);
    // Must have ciphertext
    expect(envelope.ciphertext).toBeInstanceOf(Uint8Array);
    expect(envelope.ciphertext.length).toBeGreaterThan(0);
    // Version field for migration tracking
    expect(envelope.version).toBe(1);
  });

  test("key export/import roundtrip works", async () => {
    const key = await generateKey();
    const exported = await exportKey(key);
    const imported = await importKey(exported);
    // Keys should produce equivalent encrypt/decrypt
    const plaintext = enc.encode("roundtrip test");
    const envelope = await encrypt(key, plaintext);
    const recovered = await decrypt(imported, envelope);
    expect(dec.decode(recovered)).toBe("roundtrip test");
  });

  test("serialized envelope can be stored as JSON and restored", async () => {
    const key = await generateKey();
    const plaintext = enc.encode("snapshot payload");
    const envelope = await encrypt(key, plaintext);

    // Serialize to JSON (what we'd store in Walrus receipt / blobId index)
    const json = JSON.stringify({
      version: envelope.version,
      iv: Array.from(envelope.iv),
      ciphertext: Array.from(envelope.ciphertext),
    });

    // Deserialize and decrypt
    const parsed = JSON.parse(json);
    const restored = {
      version: parsed.version as 1,
      iv: new Uint8Array(parsed.iv as number[]),
      ciphertext: new Uint8Array(parsed.ciphertext as number[]),
    };
    const recovered = await decrypt(key, restored);
    expect(dec.decode(recovered)).toBe("snapshot payload");
  });
});
