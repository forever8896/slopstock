import { test, expect } from "bun:test";
import { storeTrack, type WalrusStore } from "./store-audio.ts";

/** Fake Walrus backend so the unit test needs no network. */
function fakeWalrus(): { store: WalrusStore; stored: Uint8Array[] } {
  const stored: Uint8Array[] = [];
  return {
    stored,
    store: {
      async store(body) {
        stored.push(typeof body === "string" ? new TextEncoder().encode(body) : body);
        return { blobId: "BLOB_abc123", alreadyCertified: false };
      },
      publicUrl(blobId) {
        return `https://aggregator.walrus-testnet.walrus.space/v1/blobs/${blobId}`;
      },
    },
  };
}

test("storeTrack pins the audio bytes and returns a browser-playable aggregator URL", async () => {
  const audio = new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]); // 'ID3' + bytes
  const { store, stored } = fakeWalrus();
  const receipt = await storeTrack(audio, { title: "t", style: "ny-drill" }, { client: store });

  expect(receipt.blobId).toBe("BLOB_abc123");
  expect(receipt.aggregatorUrl).toBe("https://aggregator.walrus-testnet.walrus.space/v1/blobs/BLOB_abc123");
  expect(receipt.size).toBe(audio.length);
  // The exact bytes were stored (binary, not stringified).
  expect(stored[0]).toEqual(audio);
});
