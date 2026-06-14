/**
 * Drill-Cypher step 3 — pin a generated track to Walrus.
 *
 * The track is a binary MP3. Walrus is content-addressed regardless of type,
 * so the same client that stores JSON manifests/receipts stores audio blobs.
 * The returned aggregatorUrl is a public HTTPS URL a browser can play directly
 * (<audio src>), with no operator proxying — the media-storage bounty angle on
 * top of the skills/memory storage story (plan 03).
 */

import { WalrusClient } from "../../storage/walrus-client.ts";

/** The slice of WalrusClient store-audio needs — narrowed for injection/tests. */
export interface WalrusStore {
  store(body: Uint8Array | string, opts?: { epochs?: number }): Promise<{ blobId: string; alreadyCertified: boolean }>;
  publicUrl(blobId: string): string;
}

export interface TrackMetadata {
  title: string;
  style: string;
  /** Defaults to audio/mpeg; recorded for the receipt, not sent to Walrus. */
  contentType?: string;
}

export interface TrackReceipt {
  blobId: string;
  aggregatorUrl: string;
  size: number;
  alreadyCertified: boolean;
  contentType: string;
}

export interface StoreTrackOpts {
  client?: WalrusStore;
  /** Walrus storage lifetime; default keeps it alive past the weekend. */
  epochs?: number;
}

export async function storeTrack(
  audio: Uint8Array,
  metadata: TrackMetadata,
  opts: StoreTrackOpts = {},
): Promise<TrackReceipt> {
  const client = opts.client ?? new WalrusClient();
  const res = await client.store(audio, opts.epochs != null ? { epochs: opts.epochs } : undefined);
  return {
    blobId: res.blobId,
    aggregatorUrl: client.publicUrl(res.blobId),
    size: audio.length,
    alreadyCertified: res.alreadyCertified,
    contentType: metadata.contentType ?? "audio/mpeg",
  };
}
