/**
 * Persistent receipt store backed by bun:sqlite. Survives restarts so the
 * subscriber-side attestation flow stays valid across operator reboots.
 *
 * Schema is intentionally narrow — full receipt JSON is stored as a blob and
 * a few fields are denormalized for query speed (callId, tokenId, subscriber,
 * ts).
 *
 * v2 addition: each receipt is also pinned to Walrus decentralized storage.
 * The walrusBlobId is stored in the DB so the web inference tape can read
 * receipts directly from the public Walrus aggregator without hitting the
 * operator disk.
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InferenceReceipt } from "@stratum/shared";
import { pinReceiptToWalrus } from "../storage/receipt-pinning.ts";

let _db: Database | null = null;

function db(): Database {
  if (_db) return _db;
  const path = process.env["RECEIPTS_DB_PATH"] ?? "./data/receipts.db";
  mkdirSync(dirname(path), { recursive: true });
  const conn = new Database(path);
  conn.exec(`
    CREATE TABLE IF NOT EXISTS receipts (
      callId      TEXT PRIMARY KEY,
      tokenId     TEXT NOT NULL,
      subscriber  TEXT NOT NULL,
      ts          INTEGER NOT NULL,
      receipt     TEXT NOT NULL,
      walrusBlobId TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_token_ts ON receipts(tokenId, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_receipts_subscriber_ts ON receipts(subscriber, ts DESC);
  `);
  // Best-effort schema migration: add walrusBlobId column if missing
  try {
    conn.exec("ALTER TABLE receipts ADD COLUMN walrusBlobId TEXT");
  } catch {
    // Column already exists — ignore
  }
  _db = conn;
  return conn;
}

export function recordReceipt(r: InferenceReceipt): void {
  // 1. Write to SQLite immediately (synchronous, no network dependency)
  db()
    .prepare(
      "INSERT OR REPLACE INTO receipts (callId, tokenId, subscriber, ts, receipt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(r.callId, r.tokenId.toString(), r.subscriber.toLowerCase(), r.ts, JSON.stringify(r));

  // 2. Pin to Walrus asynchronously (non-blocking, best-effort)
  //    Update the walrusBlobId column once the upload completes.
  pinReceiptToWalrus(r)
    .then((blobId) => {
      try {
        db()
          .prepare("UPDATE receipts SET walrusBlobId = ? WHERE callId = ?")
          .run(blobId, r.callId);
        console.log(`[receipts] pinned ${r.callId.slice(0, 8)}… → walrus:${blobId.slice(0, 16)}…`);
      } catch (e) {
        console.warn(`[receipts] walrus blobId update failed: ${(e as Error).message}`);
      }
    })
    .catch((e) => {
      console.warn(`[receipts] walrus pin failed for ${r.callId}: ${(e as Error).message}`);
    });
}

export function findReceipt(callId: string): InferenceReceipt | undefined {
  const row = db().prepare("SELECT receipt FROM receipts WHERE callId = ?").get(callId) as
    | { receipt: string }
    | undefined;
  if (!row) return undefined;
  return JSON.parse(row.receipt) as InferenceReceipt;
}

/**
 * Look up the Walrus blobId for a receipt.
 * Returns undefined if the receipt hasn't been pinned yet (pin is async).
 */
export function findReceiptBlobId(callId: string): string | undefined {
  const row = db()
    .prepare("SELECT walrusBlobId FROM receipts WHERE callId = ?")
    .get(callId) as { walrusBlobId: string | null } | undefined;
  return row?.walrusBlobId ?? undefined;
}

export interface ListReceiptsOpts {
  tokenId?: bigint;
  subscriber?: string;
  limit?: number;
}

/**
 * TEST-ONLY: Close and discard the current DB connection so the next call to
 * db() opens a fresh one. Set RECEIPTS_DB_PATH=:memory: before calling this
 * to get an empty in-memory database.
 */
export function __resetReceiptsDbForTest(): void {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function listReceipts(opts: ListReceiptsOpts = {}): InferenceReceipt[] {
  const limit = Math.min(opts.limit ?? 50, 500);
  const conditions: string[] = [];
  const params: (string | number)[] = [];
  if (opts.tokenId !== undefined) {
    conditions.push("tokenId = ?");
    params.push(opts.tokenId.toString());
  }
  if (opts.subscriber) {
    conditions.push("subscriber = ?");
    params.push(opts.subscriber.toLowerCase());
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const rows = db()
    .prepare(`SELECT receipt FROM receipts ${where} ORDER BY ts DESC LIMIT ?`)
    .all(...params, limit) as { receipt: string }[];
  return rows.map((row) => JSON.parse(row.receipt) as InferenceReceipt);
}
