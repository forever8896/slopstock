/**
 * ENS snapshot pointer — the mutable layer that lets a stateless operator find
 * each agent's latest Walrus snapshot. One text record per agent subname:
 *   agent-snapshot = <walrusBlobId>
 * Public pointer, sealed bytes. Written on mainnet via the existing
 * setTextRecords path; read via the PublicResolver `text` call.
 */
import { type Hex } from "viem";
import { setTextRecords, readTextRecord, type TextRecord } from "./ens-subname.ts";

export const SNAPSHOT_TEXT_KEY = "agent-snapshot" as const;

export function buildPointerRecords(blobId: string): TextRecord[] {
  return [{ key: SNAPSHOT_TEXT_KEY, value: blobId }];
}

/** Write the latest snapshot blobId into the agent's ENS record (mainnet tx). */
export async function setSnapshotPointer(opts: {
  ensName: string;
  blobId: string;
  deployerKey: Hex;
  rpcUrl?: string;
}): Promise<void> {
  await setTextRecords({
    ensName: opts.ensName.toLowerCase(),
    records: buildPointerRecords(opts.blobId),
    deployerKey: opts.deployerKey,
    rpcUrl: opts.rpcUrl,
    network: "mainnet",
  });
}

/** Read the agent's latest snapshot blobId from ENS, or null if unset. */
export async function readSnapshotPointer(opts: {
  ensName: string;
  rpcUrl?: string;
}): Promise<string | null> {
  const value = await readTextRecord(opts.ensName, SNAPSHOT_TEXT_KEY, {
    rpcUrl: opts.rpcUrl,
    network: "mainnet",
  });
  return value && value.length > 0 ? value : null;
}
