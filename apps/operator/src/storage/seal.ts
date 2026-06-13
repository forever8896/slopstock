// apps/operator/src/storage/seal.ts  (stub — replaced in a later task)
import type { SnapshotCipher } from "./encryption.ts";
export class SealCipher implements SnapshotCipher {
  readonly kind = "seal" as const;
  static async fromEnv(): Promise<SealCipher> { throw new Error("SealCipher not implemented yet (Task A3)"); }
  async encrypt(_plaintext: Uint8Array, _id: string): Promise<Uint8Array> { throw new Error("not impl"); }
  async decrypt(_bytes: Uint8Array, _id: string): Promise<Uint8Array> { throw new Error("not impl"); }
}
