/**
 * Persistent receipt store backed by bun:sqlite. Survives restarts so the
 * subscriber-side attestation flow stays valid across operator reboots.
 *
 * Schema is intentionally narrow — full receipt JSON is stored as a blob and
 * a few fields are denormalized for query speed (callId, tokenId, subscriber,
 * ts).
 */

import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { InferenceReceipt } from "@stratum/shared";

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
      receipt     TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_receipts_token_ts ON receipts(tokenId, ts DESC);
    CREATE INDEX IF NOT EXISTS idx_receipts_subscriber_ts ON receipts(subscriber, ts DESC);
  `);
  _db = conn;
  return conn;
}

export function recordReceipt(r: InferenceReceipt): void {
  db()
    .prepare(
      "INSERT OR REPLACE INTO receipts (callId, tokenId, subscriber, ts, receipt) VALUES (?, ?, ?, ?, ?)",
    )
    .run(r.callId, r.tokenId.toString(), r.subscriber.toLowerCase(), r.ts, JSON.stringify(r));
}

export function findReceipt(callId: string): InferenceReceipt | undefined {
  const row = db().prepare("SELECT receipt FROM receipts WHERE callId = ?").get(callId) as
    | { receipt: string }
    | undefined;
  if (!row) return undefined;
  return JSON.parse(row.receipt) as InferenceReceipt;
}

export interface ListReceiptsOpts {
  tokenId?: bigint;
  subscriber?: string;
  limit?: number;
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
