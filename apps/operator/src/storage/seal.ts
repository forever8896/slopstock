/**
 * SealCipher — agent-state encryption via Mysten Seal threshold IBE.
 * encrypt: client-side hybrid IBE, no Sui tx. decrypt: dry-run of seal_approve
 * via the operator SessionKey, no gas. Mysten open-mode key servers.
 * id layout (allowlist policy): [allowlistId bytes] ++ [utf8(tokenId)].
 *
 * SDK notes (@mysten/seal@1.x + @mysten/sui@2.x — verified against installed defs):
 *  - getAllowlistedKeyServers() was removed from @mysten/seal in v0.4.23. We accept
 *    key-server object IDs via SEAL_KEY_SERVERS (comma-separated) and fall back to the
 *    canonical Mysten open-mode testnet key servers when on testnet.
 *  - @mysten/sui v2 renamed SuiClient -> SuiJsonRpcClient (subpath @mysten/sui/jsonRpc)
 *    and getFullnodeUrl -> getJsonRpcFullnodeUrl. SuiJsonRpcClient exposes `.core`, so it
 *    satisfies Seal's SealCompatibleClient (ClientWithExtensions<{ core: CoreClient }>).
 *  - SessionKey.create accepts a `signer`; passing it lets the SDK sign the personal
 *    message internally (no manual signPersonalMessage / setPersonalMessageSignature).
 */
import { SealClient, SessionKey } from "@mysten/seal";
import { SuiJsonRpcClient, getJsonRpcFullnodeUrl } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromHex } from "@mysten/sui/utils";
import type { SnapshotCipher } from "./encryption.ts";

type SealNetwork = "testnet" | "mainnet";

/**
 * Canonical Mysten Labs open-mode key servers (verified-independent, Open mode).
 * Source: Seal docs Pricing page — "Verified key servers". These match the IDs that
 * the removed getAllowlistedKeyServers('testnet') helper used to return.
 * Mainnet has no Mysten open-mode public object IDs (Enoki-gated / third-party only),
 * so a mainnet deployment MUST set SEAL_KEY_SERVERS explicitly.
 */
const MYSTEN_OPEN_KEY_SERVERS: Record<SealNetwork, string[]> = {
  testnet: [
    "0x73d05d62c18d9374e3ea529e8e0ed6161da1a141a94d3f76ae3fe4e99356db75", // mysten-testnet-1
    "0xf5d14a81a982144ae441cd7d64b09027f116a468bd36e7eca494f750591623c8", // mysten-testnet-2
  ],
  mainnet: [],
};

export class SealCipher implements SnapshotCipher {
  readonly kind = "seal" as const;
  private sessionKey: SessionKey | null = null;
  private constructor(
    private readonly client: SealClient,
    private readonly suiClient: SuiJsonRpcClient,
    private readonly keypair: Ed25519Keypair,
    private readonly packageId: string,
    private readonly allowlistId: string,
    private readonly threshold: number,
  ) {}

  static async fromEnv(): Promise<SealCipher> {
    const packageId = req("SEAL_PACKAGE_ID");
    const allowlistId = req("SEAL_ALLOWLIST_ID");
    const secret = req("SUI_SEAL_KEYPAIR");
    const network = (process.env["SEAL_NETWORK"] ?? "testnet");
    if (network !== "testnet" && network !== "mainnet") {
      throw new Error(`SealCipher: SEAL_NETWORK must be "testnet" or "mainnet" (got "${network}")`);
    }
    const threshold = Number(process.env["SEAL_THRESHOLD"] ?? "2");
    if (!Number.isInteger(threshold) || threshold < 1) {
      throw new Error(`SealCipher: SEAL_THRESHOLD must be a positive integer (got "${process.env["SEAL_THRESHOLD"]}")`);
    }

    const serverIds = (process.env["SEAL_KEY_SERVERS"] ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    const objectIds = serverIds.length > 0 ? serverIds : MYSTEN_OPEN_KEY_SERVERS[network];
    if (objectIds.length === 0) {
      throw new Error(
        `SealCipher: no key servers for network "${network}" — set SEAL_KEY_SERVERS (comma-separated key-server object IDs)`,
      );
    }

    const suiClient = new SuiJsonRpcClient({ network, url: getJsonRpcFullnodeUrl(network) });
    const serverConfigs = objectIds.map((objectId) => ({ objectId, weight: 1 }));
    const client = new SealClient({ suiClient, serverConfigs, verifyKeyServers: false });

    let keypair: Ed25519Keypair;
    try {
      keypair = secret.startsWith("suiprivkey")
        ? Ed25519Keypair.fromSecretKey(secret)
        : Ed25519Keypair.fromSecretKey(fromHex(secret.replace(/^0x/, "")));
    } catch (e) {
      throw new Error(`SealCipher: SUI_SEAL_KEYPAIR is not a valid key (expected suiprivkey... or 0x-prefixed hex): ${(e as Error).message}`);
    }

    return new SealCipher(client, suiClient, keypair, packageId, allowlistId, threshold);
  }

  private idBytes(tokenId: string): Uint8Array {
    const prefix = fromHex(this.allowlistId.replace(/^0x/, ""));
    const suffix = new TextEncoder().encode(tokenId);
    const out = new Uint8Array(prefix.length + suffix.length);
    out.set(prefix, 0);
    out.set(suffix, prefix.length);
    return out;
  }

  async encrypt(plaintext: Uint8Array, id: string): Promise<Uint8Array> {
    const { encryptedObject } = await this.client.encrypt({
      threshold: this.threshold,
      packageId: this.packageId,
      id: toHexNoPrefix(this.idBytes(id)),
      data: plaintext,
    });
    return encryptedObject;
  }

  async decrypt(bytes: Uint8Array, id: string): Promise<Uint8Array> {
    // NOTE (deployment runbook): SessionKey.create pins packageId at call time. The Seal SDK
    // validates that packageId matches package version "1" on-chain. If the on-chain package is
    // upgraded (UPGRADE tx), the new package objectId will differ from version "1" and the key
    // server will reject with InvalidPackageError. Always re-deploy allowlist + update
    // SEAL_PACKAGE_ID to the version-1 objectId of the new publication; do NOT reuse old ID.
    if (!this.sessionKey || this.sessionKey.isExpired()) {
      this.sessionKey = await SessionKey.create({
        address: this.keypair.toSuiAddress(),
        packageId: this.packageId,
        ttlMin: 10,
        signer: this.keypair,
        suiClient: this.suiClient,
      });
    }
    const sessionKey = this.sessionKey;
    const tx = new Transaction();
    tx.moveCall({
      target: `${this.packageId}::allowlist::seal_approve`,
      arguments: [tx.pure.vector("u8", Array.from(this.idBytes(id))), tx.object(this.allowlistId)],
    });
    const txBytes = await tx.build({ client: this.suiClient, onlyTransactionKind: true });
    return this.client.decrypt({ data: bytes, sessionKey, txBytes });
  }
}

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`SealCipher: ${name} is required (set it in operator env)`);
  return v;
}

function toHexNoPrefix(b: Uint8Array): string {
  return Array.from(b)
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
