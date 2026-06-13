/**
 * Tests for loadConfig() / envSchema defaults — keeps config.ts honest.
 *
 * loadConfig() reads process.env, so we manipulate process.env before each
 * call and restore it afterwards.  The minimal required vars are those without
 * .default() / .optional(): OPERATOR_PRIVATE_KEY, AGENT_NFT_ADDRESS,
 * AGENT_REGISTRY_ADDRESS, AGENT_VAULT_ADDRESS.
 */

import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { loadConfig } from "./config";

const REQUIRED: Record<string, string> = {
  OPERATOR_PRIVATE_KEY: "0x" + "a".repeat(64),
  AGENT_NFT_ADDRESS: "0x" + "b".repeat(40),
  AGENT_REGISTRY_ADDRESS: "0x" + "c".repeat(40),
  AGENT_VAULT_ADDRESS: "0x" + "d".repeat(40),
};

let savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  // Save and inject required vars
  savedEnv = {};
  for (const key of Object.keys(REQUIRED)) {
    savedEnv[key] = process.env[key];
    process.env[key] = REQUIRED[key];
  }
});

afterEach(() => {
  // Restore
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = val;
    }
  }
});

describe("loadConfig defaults", () => {
  it("SNAPSHOT_ENCRYPTION defaults to 'aes'", () => {
    delete process.env["SNAPSHOT_ENCRYPTION"];
    const cfg = loadConfig();
    expect(cfg.SNAPSHOT_ENCRYPTION).toBe("aes");
  });

  it("ENS_SNAPSHOT_ENABLED defaults to false (boolean)", () => {
    delete process.env["ENS_SNAPSHOT_ENABLED"];
    const cfg = loadConfig();
    expect(cfg.ENS_SNAPSHOT_ENABLED).toBe(false);
  });

  it("ENS_SNAPSHOT_ENABLED='1' yields true", () => {
    process.env["ENS_SNAPSHOT_ENABLED"] = "1";
    const cfg = loadConfig();
    expect(cfg.ENS_SNAPSHOT_ENABLED).toBe(true);
  });

  it("ENS_SNAPSHOT_ENABLED='true' yields true", () => {
    process.env["ENS_SNAPSHOT_ENABLED"] = "true";
    const cfg = loadConfig();
    expect(cfg.ENS_SNAPSHOT_ENABLED).toBe(true);
  });

  it("ENS_SNAPSHOT_ENABLED='false' yields false (not the z.coerce.boolean footgun)", () => {
    process.env["ENS_SNAPSHOT_ENABLED"] = "false";
    const cfg = loadConfig();
    expect(cfg.ENS_SNAPSHOT_ENABLED).toBe(false);
  });

  it("L1_RPC defaults to empty string", () => {
    delete process.env["L1_RPC"];
    const cfg = loadConfig();
    expect(cfg.L1_RPC).toBe("");
  });

  it("SEAL_NETWORK defaults to 'testnet'", () => {
    delete process.env["SEAL_NETWORK"];
    const cfg = loadConfig();
    expect(cfg.SEAL_NETWORK).toBe("testnet");
  });

  it("SEAL_THRESHOLD defaults to 2", () => {
    delete process.env["SEAL_THRESHOLD"];
    const cfg = loadConfig();
    expect(cfg.SEAL_THRESHOLD).toBe(2);
  });

  it("SEAL_PACKAGE_ID defaults to empty string", () => {
    delete process.env["SEAL_PACKAGE_ID"];
    const cfg = loadConfig();
    expect(cfg.SEAL_PACKAGE_ID).toBe("");
  });

  it("SEAL_ALLOWLIST_ID defaults to empty string", () => {
    delete process.env["SEAL_ALLOWLIST_ID"];
    const cfg = loadConfig();
    expect(cfg.SEAL_ALLOWLIST_ID).toBe("");
  });

  it("SUI_SEAL_KEYPAIR defaults to empty string", () => {
    delete process.env["SUI_SEAL_KEYPAIR"];
    const cfg = loadConfig();
    expect(cfg.SUI_SEAL_KEYPAIR).toBe("");
  });

  it("SEAL_KEY_SERVERS defaults to empty string", () => {
    delete process.env["SEAL_KEY_SERVERS"];
    const cfg = loadConfig();
    expect(cfg.SEAL_KEY_SERVERS).toBe("");
  });
});
