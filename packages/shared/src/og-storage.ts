/**
 * 0G Storage client — interface only.
 *
 * Architecture decision (PRD §5.1, revised): the operator is the single point
 * of integration for 0G Storage. The browser POSTs raw manifest content to
 * the operator's `/og-storage/pin` endpoint, the operator pins via the SDK,
 * the operator returns a rootHash. Reads go through the operator too.
 *
 * Why operator-proxy and not browser-direct:
 *   1. Single SDK integration to test/deploy (Bun/Node, not browser)
 *   2. No Next.js SSR/bundle issues
 *   3. The on-chain hash binding still holds — operator can't lie about content
 *      because /agents/register verifies keccak256(canonical(manifest)) ===
 *      iNFT.metadataHash before accepting registration
 *
 * The `OgStorageClient` interface is the same for browser (HTTP-proxy impl)
 * and operator (real SDK impl). Both live in this package.
 *
 * Reference URI scheme: `0g-storage://<rootHash>` — hash is hex (no 0x prefix)
 * for compatibility with 0G's tooling.
 */

export interface OgStoragePinResult {
  rootHash: string;            // hex, no 0x prefix
  uri: string;                 // "0g-storage://<rootHash>"
  size: number;                // byte length of pinned content
  /** True if the underlying impl really hit 0G Storage; false if shadow-only.
   *  Operator will set this honestly so the UI can badge "0G Storage degraded". */
  realPin: boolean;
}

export interface OgStorageClient {
  pinJson(obj: unknown): Promise<OgStoragePinResult>;
  pinText(content: string, contentType?: string): Promise<OgStoragePinResult>;
  fetchJson<T = unknown>(rootHash: string): Promise<T>;
  fetchText(rootHash: string): Promise<string>;
}

/** Strip optional `0g-storage://` prefix and any 0x prefix; lower-case. */
export function normalizeRootHash(input: string): string {
  let s = input.trim();
  if (s.startsWith("0g-storage://")) s = s.slice("0g-storage://".length);
  if (s.startsWith("0x")) s = s.slice(2);
  return s.toLowerCase();
}

export function rootHashToUri(rootHash: string): string {
  return `0g-storage://${normalizeRootHash(rootHash)}`;
}
