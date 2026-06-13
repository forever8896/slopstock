import { test, expect } from "bun:test";
import { AesCipher } from "./encryption.ts";
import { generateKey, exportKeyToBase64 } from "./crypto.ts";

test("AesCipher round-trips bytes; id is ignored", async () => {
  const keyB64 = await exportKeyToBase64(await generateKey());
  const cipher = await AesCipher.fromBase64(keyB64);
  const plain = new TextEncoder().encode("hermes brain bytes");
  const sealed = await cipher.encrypt(plain, "3");
  expect(Buffer.from(sealed).equals(Buffer.from(plain))).toBe(false);
  const back = await cipher.decrypt(sealed, "3");
  expect(new TextDecoder().decode(back)).toBe("hermes brain bytes");
});

test("AesCipher decrypt with wrong key throws", async () => {
  const a = await AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
  const b = await AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
  const sealed = await a.encrypt(new TextEncoder().encode("x"), "3");
  await expect(b.decrypt(sealed, "3")).rejects.toThrow();
});
