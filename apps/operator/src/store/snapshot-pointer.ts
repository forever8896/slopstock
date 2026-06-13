/**
 * ENS snapshot pointer — the mutable layer that lets a stateless operator find
 * each agent's latest Walrus snapshot. One text record per agent subname:
 *   agent-snapshot = <walrusBlobId>
 * Public pointer, sealed bytes. Written on mainnet via the existing
 * setTextRecords path; read via the PublicResolver `text` call.
 */
import { createPublicClient, http, namehash, type Hex } from "viem";
import { mainnet } from "viem/chains";
import { setTextRecords, type TextRecord } from "./ens-subname.ts";

export const SNAPSHOT_TEXT_KEY = "agent-snapshot" as const;

const PUBLIC_RESOLVER_MAINNET = "0x4976fb03C32e5B8cfe2b6cCB31c09Ba78EBaBa41" as Hex;

const RESOLVER_TEXT_ABI = [
  {
    type: "function",
    name: "text",
    stateMutability: "view",
    inputs: [
      { name: "node", type: "bytes32" },
      { name: "key", type: "string" },
    ],
    outputs: [{ type: "string" }],
  },
] as const;

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
    ensName: opts.ensName,
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
  const client = createPublicClient({
    chain: mainnet,
    transport: http(opts.rpcUrl),
  });
  const value = (await client.readContract({
    address: PUBLIC_RESOLVER_MAINNET,
    abi: RESOLVER_TEXT_ABI,
    functionName: "text",
    args: [namehash(opts.ensName.toLowerCase()), SNAPSHOT_TEXT_KEY],
  })) as string;
  return value && value.length > 0 ? value : null;
}
