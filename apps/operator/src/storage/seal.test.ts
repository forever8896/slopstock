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

test("SealCipher.fromEnv throws a clear error when SEAL_ALLOWLIST_ID unset", async () => {
  const prevPkg = process.env["SEAL_PACKAGE_ID"];
  const prevAllowlist = process.env["SEAL_ALLOWLIST_ID"];
  process.env["SEAL_PACKAGE_ID"] = "0xdeadbeef";
  delete process.env["SEAL_ALLOWLIST_ID"];
  await expect(SealCipher.fromEnv()).rejects.toThrow(/SEAL_ALLOWLIST_ID/);
  if (prevPkg !== undefined) process.env["SEAL_PACKAGE_ID"] = prevPkg;
  else delete process.env["SEAL_PACKAGE_ID"];
  if (prevAllowlist !== undefined) process.env["SEAL_ALLOWLIST_ID"] = prevAllowlist;
});

test("SealCipher.fromEnv throws a clear error when SUI_SEAL_KEYPAIR unset", async () => {
  const prevPkg = process.env["SEAL_PACKAGE_ID"];
  const prevAllowlist = process.env["SEAL_ALLOWLIST_ID"];
  const prevKeypair = process.env["SUI_SEAL_KEYPAIR"];
  process.env["SEAL_PACKAGE_ID"] = "0xdeadbeef";
  process.env["SEAL_ALLOWLIST_ID"] = "0xcafebabe";
  delete process.env["SUI_SEAL_KEYPAIR"];
  await expect(SealCipher.fromEnv()).rejects.toThrow(/SUI_SEAL_KEYPAIR/);
  if (prevPkg !== undefined) process.env["SEAL_PACKAGE_ID"] = prevPkg;
  else delete process.env["SEAL_PACKAGE_ID"];
  if (prevAllowlist !== undefined) process.env["SEAL_ALLOWLIST_ID"] = prevAllowlist;
  else delete process.env["SEAL_ALLOWLIST_ID"];
  if (prevKeypair !== undefined) process.env["SUI_SEAL_KEYPAIR"] = prevKeypair;
});
