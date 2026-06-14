import { test, expect } from "bun:test";
import { SealCipher } from "./seal.ts";
import { resolveKeyServerIds, resolveVerifyKeyServers } from "./seal-config.ts";

const LIVE = process.env["SEAL_LIVE_TEST"] === "1"; // set with real SEAL_* env to run

// ── key-server resolution (pure, no network) ──────────────────────────────────
test("resolveKeyServerIds falls back to baked-in Mysten servers on testnet", () => {
  const ids = resolveKeyServerIds("testnet", undefined);
  expect(ids.length).toBe(2); // two canonical Mysten open-mode testnet key servers
  expect(ids.every((id) => id.startsWith("0x"))).toBe(true);
});

test("resolveKeyServerIds REQUIRES explicit SEAL_KEY_SERVERS on mainnet", () => {
  // Mainnet has no baked-in defaults — operator must choose verified key servers.
  expect(() => resolveKeyServerIds("mainnet", undefined)).toThrow(/SEAL_KEY_SERVERS/);
  expect(() => resolveKeyServerIds("mainnet", "")).toThrow(/SEAL_KEY_SERVERS/);
});

test("resolveKeyServerIds parses + trims a comma-separated list (mainnet)", () => {
  expect(resolveKeyServerIds("mainnet", " 0xaaa , 0xbbb ,0xccc ")).toEqual(["0xaaa", "0xbbb", "0xccc"]);
});

test("resolveKeyServerIds lets an explicit list override testnet defaults", () => {
  expect(resolveKeyServerIds("testnet", "0xfeed")).toEqual(["0xfeed"]);
});

// ── verify-key-servers resolution (pure, no network) ──────────────────────────
test("resolveVerifyKeyServers defaults to TRUE on mainnet, FALSE on testnet", () => {
  expect(resolveVerifyKeyServers("mainnet", undefined)).toBe(true);
  expect(resolveVerifyKeyServers("testnet", undefined)).toBe(false);
});

test("resolveVerifyKeyServers honors an explicit override either way", () => {
  expect(resolveVerifyKeyServers("mainnet", "false")).toBe(false);
  expect(resolveVerifyKeyServers("mainnet", "0")).toBe(false);
  expect(resolveVerifyKeyServers("testnet", "true")).toBe(true);
  expect(resolveVerifyKeyServers("testnet", "1")).toBe(true);
});

test("resolveVerifyKeyServers rejects a non-boolean override", () => {
  expect(() => resolveVerifyKeyServers("mainnet", "yes-please")).toThrow(/SEAL_VERIFY_KEY_SERVERS/);
});

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
