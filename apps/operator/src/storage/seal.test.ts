import { test, expect } from "bun:test";
import { SealCipher } from "./seal.ts";

const LIVE = process.env["SEAL_LIVE_TEST"] === "1"; // set with real SEAL_* env to run

test.if(LIVE)("SealCipher round-trips via testnet key servers", async () => {
  const cipher = await SealCipher.fromEnv();
  const plain = new TextEncoder().encode("sealed hermes brain");
  const sealed = await cipher.encrypt(plain, "3");
  expect(Buffer.from(sealed).equals(Buffer.from(plain))).toBe(false);
  const back = await cipher.decrypt(sealed, "3");
  expect(new TextDecoder().decode(back)).toBe("sealed hermes brain");
}, 60_000);

test("SealCipher.fromEnv throws a clear error when SEAL_PACKAGE_ID unset", async () => {
  const prev = process.env["SEAL_PACKAGE_ID"];
  delete process.env["SEAL_PACKAGE_ID"];
  await expect(SealCipher.fromEnv()).rejects.toThrow(/SEAL_PACKAGE_ID/);
  if (prev !== undefined) process.env["SEAL_PACKAGE_ID"] = prev;
});
