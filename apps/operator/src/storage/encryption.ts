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
} from "./crypto.ts";

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
