/**
 * Walrus decentralized storage client — zero-dependency, raw HTTP.
 *
 * Why raw HTTP and not @mysten/walrus: we're a Bun/EVM operator with no Sui
 * wallet. Public testnet publishers pay the Sui-side cost for us; reads come
 * from public aggregators. The SDK is only needed to *be* a publisher
 * (mainnet writes) or to verify blobIds trustlessly — neither is needed here.
 *
 * Content-addressed: re-uploading identical bytes returns `alreadyCertified`
 * with the same blobId, so writes are idempotent (free dedup for receipts).
 *
 * Public endpoints are best-effort, so both store and read fail over across a
 * list. testnet epoch ≈ 1 day; default epochs=90 keeps blobs alive well past
 * the hackathon. Mainnet has no public publisher — writes there need the SDK
 * + a funded Sui signer (out of scope; testnet is the bounty target).
 */

const TESTNET_PUBLISHERS = [
  "https://publisher.walrus-testnet.walrus.space",
  "https://walrus-testnet-publisher.stakely.io",
  "https://publisher.walrus-testnet.h2o-nodes.com",
];
const TESTNET_AGGREGATORS = [
  "https://aggregator.walrus-testnet.walrus.space",
  "https://walrus-testnet-aggregator.redundex.com",
];

export interface WalrusStoreResult {
  blobId: string;
  endEpoch?: number;
  /** true when this exact content was already stored (idempotent dedup). */
  alreadyCertified: boolean;
}

export interface WalrusClientOpts {
  publishers?: string[];
  aggregators?: string[];
  /** Storage lifetime in epochs (testnet epoch ≈ 1 day). */
  epochs?: number;
}

export class WalrusUnavailableError extends Error {
  constructor(op: string, detail: string) {
    super(`walrus ${op} failed across all endpoints: ${detail}`);
    this.name = "WalrusUnavailableError";
  }
}

export class WalrusClient {
  private readonly publishers: string[];
  private readonly aggregators: string[];
  private readonly epochs: number;

  constructor(opts: WalrusClientOpts = {}) {
    this.publishers = opts.publishers ?? TESTNET_PUBLISHERS;
    this.aggregators = opts.aggregators ?? TESTNET_AGGREGATORS;
    this.epochs = opts.epochs ?? 90;
  }

  /** Store bytes or a string. Fails over across publishers. */
  async store(
    body: Uint8Array | string,
    opts: { epochs?: number; permanent?: boolean } = {},
  ): Promise<WalrusStoreResult> {
    const epochs = opts.epochs ?? this.epochs;
    const qs = `epochs=${epochs}${opts.permanent ? "&permanent=true" : ""}`;
    let lastErr = "";
    for (const pub of this.publishers) {
      try {
        const res = await fetch(`${pub}/v1/blobs?${qs}`, { method: "PUT", body });
        if (!res.ok) {
          lastErr = `${pub}: ${res.status} ${(await res.text()).slice(0, 120)}`;
          continue;
        }
        const j = (await res.json()) as WalrusPutResponse;
        if (j.newlyCreated) {
          return {
            blobId: j.newlyCreated.blobObject.blobId,
            endEpoch: j.newlyCreated.blobObject.storage?.endEpoch,
            alreadyCertified: false,
          };
        }
        if (j.alreadyCertified) {
          return {
            blobId: j.alreadyCertified.blobId,
            endEpoch: j.alreadyCertified.endEpoch,
            alreadyCertified: true,
          };
        }
        lastErr = `${pub}: unrecognized response ${JSON.stringify(j).slice(0, 120)}`;
      } catch (e) {
        lastErr = `${pub}: ${(e as Error).message}`;
      }
    }
    throw new WalrusUnavailableError("store", lastErr);
  }

  /** Read bytes by blobId. Fails over across aggregators. */
  async read(blobId: string): Promise<Uint8Array> {
    let lastErr = "";
    for (const agg of this.aggregators) {
      try {
        const res = await fetch(`${agg}/v1/blobs/${blobId}`);
        if (res.ok) return new Uint8Array(await res.arrayBuffer());
        lastErr = `${agg}: ${res.status}`;
      } catch (e) {
        lastErr = `${agg}: ${(e as Error).message}`;
      }
    }
    throw new WalrusUnavailableError("read", lastErr);
  }

  async storeJson(obj: unknown, opts?: { epochs?: number }): Promise<WalrusStoreResult> {
    return this.store(JSON.stringify(obj), opts);
  }

  async readJson<T = unknown>(blobId: string): Promise<T> {
    return JSON.parse(new TextDecoder().decode(await this.read(blobId))) as T;
  }

  /** Public aggregator URL for a blob — directly fetchable by a browser
   *  (e.g. an <audio src> tag), no operator proxying. Uses the first
   *  aggregator; all aggregators serve the same content-addressed blob. */
  publicUrl(blobId: string): string {
    return `${this.aggregators[0]}/v1/blobs/${blobId}`;
  }
}

interface WalrusPutResponse {
  newlyCreated?: {
    blobObject: {
      blobId: string;
      size: number;
      storage?: { startEpoch: number; endEpoch: number };
    };
  };
  alreadyCertified?: { blobId: string; endEpoch?: number };
}
