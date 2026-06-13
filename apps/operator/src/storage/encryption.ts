/**
 * SnapshotCipher — pluggable encryption for agent state snapshots.
 * Selected by SNAPSHOT_ENCRYPTION (aes | seal). AES is the offline/CI default
 * and the disaster-recovery fallback; Seal is the live/demo + bounty path.
 */
import {
  encrypt as aesEncrypt,
  decrypt as aesDecrypt,
  serializeEnvelope,
  deserializeEnvelope,
  importKeyFromBase64,
  generateKey,
  exportKeyToBase64,
} from "./crypto.ts";
import { SealCipher } from "./seal.ts";

export interface SnapshotCipher {
  /** Encrypt plaintext → serialized envelope bytes (stored on Walrus). `id` scopes the agent (Seal identity). */
  encrypt(plaintext: Uint8Array, id: string): Promise<Uint8Array>;
  /** Decrypt serialized envelope bytes → plaintext. */
  decrypt(bytes: Uint8Array, id: string): Promise<Uint8Array>;
  readonly kind: "aes" | "seal";
}

export class AesCipher implements SnapshotCipher {
  readonly kind = "aes" as const;
  private constructor(private readonly key: CryptoKey) {}

  static async fromBase64(b64: string): Promise<AesCipher> {
    return new AesCipher(await importKeyFromBase64(b64));
  }

  async encrypt(plaintext: Uint8Array, _id: string): Promise<Uint8Array> {
    return serializeEnvelope(await aesEncrypt(this.key, plaintext));
  }

  async decrypt(bytes: Uint8Array, _id: string): Promise<Uint8Array> {
    return aesDecrypt(this.key, deserializeEnvelope(bytes));
  }
}

/**
 * Build the SnapshotCipher selected by SNAPSHOT_ENCRYPTION.
 *   aes  (default) — AesCipher from AGENT_SNAPSHOT_KEY (base64url)
 *   seal           — SealCipher (threshold IBE over Mysten open key servers)
 * If AGENT_SNAPSHOT_KEY is unset for aes, a per-process key is generated
 * (snapshots only survive restarts if the env var is set).
 */
export async function getSnapshotCipher(): Promise<SnapshotCipher> {
  const mode = process.env["SNAPSHOT_ENCRYPTION"] ?? "aes";
  if (mode === "seal") return SealCipher.fromEnv();
  const b64 = process.env["AGENT_SNAPSHOT_KEY"];
  if (b64) return AesCipher.fromBase64(b64);
  console.warn("[operator] AGENT_SNAPSHOT_KEY unset — using ephemeral key; snapshots will not survive restart");
  return AesCipher.fromBase64(await exportKeyToBase64(await generateKey()));
}
