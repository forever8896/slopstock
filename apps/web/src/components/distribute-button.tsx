"use client";

import { useState } from "react";
import { useAccount, useChainId, useSwitchChain, useWriteContract } from "wagmi";
import { decodeEventLog, type Hex } from "viem";

const BASE_CHAIN_ID = 84532;

const revenueVaultAbi = [
  {
    type: "function",
    name: "snap",
    stateMutability: "nonpayable",
    inputs: [],
    outputs: [{ name: "snapshotId", type: "uint256" }],
  },
  {
    type: "function",
    name: "distributeTo",
    stateMutability: "nonpayable",
    inputs: [
      { name: "snapshotId", type: "uint256" },
      { name: "holder", type: "address" },
    ],
    outputs: [],
  },
  {
    type: "event",
    name: "Snapped",
    inputs: [
      { name: "snapshotId", type: "uint256", indexed: true },
      { name: "timepoint", type: "uint256", indexed: false },
      { name: "balance", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "Distributed",
    inputs: [
      { name: "snapshotId", type: "uint256", indexed: true },
      { name: "holder", type: "address", indexed: true },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
] as const;

interface Props {
  vault: Hex;
  /** Current ShareToken holders to push payouts to. If empty, the vault is
   *  snapped but nothing is paid out (no one to pay). */
  holders: Hex[];
}

export function DistributeButton({ vault, holders }: Props) {
  const { isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();

  const [pending, setPending] = useState(false);
  const [phase, setPhase] = useState<"idle" | "snap" | "push" | "done">("idle");
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{
    snapshotId: string;
    balanceUsdc: string;
    snapTx: Hex;
    payouts: number;
  } | null>(null);

  async function snap() {
    if (!isConnected) return;
    setPending(true);
    setPhase("snap");
    setError(null);
    setProgress({ done: 0, total: 0 });
    try {
      if (chainId !== BASE_CHAIN_ID) await switchChain({ chainId: BASE_CHAIN_ID });

      // 1. snap() — record balance + past block as the snapshot timepoint.
      const snapTx = await writeContractAsync({
        address: vault,
        abi: revenueVaultAbi,
        functionName: "snap",
        chainId: BASE_CHAIN_ID,
        gas: 800_000n,
      });
      const { createPublicClient, http } = await import("viem");
      const { baseSepolia } = await import("viem/chains");
      const publicClient = createPublicClient({ chain: baseSepolia, transport: http() });
      const receipt = await publicClient.waitForTransactionReceipt({ hash: snapTx });
      let snapped: { snapshotId: bigint; balance: bigint } | null = null;
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== vault.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: revenueVaultAbi,
            eventName: "Snapped",
            topics: log.topics,
            data: log.data,
          });
          snapped = decoded.args as { snapshotId: bigint; balance: bigint };
          break;
        } catch {
          continue;
        }
      }
      const snapshotId = snapped?.snapshotId ?? 0n;

      // 2. distributeTo() per holder — actually move USDC from vault to wallets.
      //    Each holder = 1 tx. With <10 holders this is acceptable; for the
      //    demo it's typically 1 (the creator).
      setPhase("push");
      setProgress({ done: 0, total: holders.length });
      let pushed = 0;
      for (const holder of holders) {
        await writeContractAsync({
          address: vault,
          abi: revenueVaultAbi,
          functionName: "distributeTo",
          args: [snapshotId, holder],
          chainId: BASE_CHAIN_ID,
          gas: 200_000n,
        });
        pushed += 1;
        setProgress({ done: pushed, total: holders.length });
      }

      setResult({
        snapshotId: snapshotId.toString(),
        balanceUsdc: snapped ? (Number(snapped.balance) / 1e6).toFixed(2) : "?",
        snapTx,
        payouts: pushed,
      });
      setPhase("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase("idle");
    } finally {
      setPending(false);
    }
  }

  if (result) {
    return (
      <div
        style={{
          marginTop: 12,
          padding: "10px 12px",
          border: "1px solid rgba(16,185,129,0.35)",
          background: "rgba(16,185,129,0.05)",
          borderRadius: 4,
          fontSize: 14,
        }}
      >
        <div className="acc" style={{ marginBottom: 4 }}>
          ✓ snapshot #{result.snapshotId} · ${result.balanceUsdc} USDC paid out to {result.payouts} holder
          {result.payouts === 1 ? "" : "s"}
        </div>
        <div style={{ color: "var(--fg-2)", fontSize: 13 }}>
          USDC moved out of the vault into shareholder wallets pro-rata to their share count.
        </div>
        <a
          href={`https://sepolia.basescan.org/tx/${result.snapTx}`}
          target="_blank"
          rel="noreferrer"
          className="acc"
          style={{ textDecoration: "underline", fontSize: 13 }}
        >
          snapshot tx on basescan ↗
        </a>
      </div>
    );
  }

  const label = !isConnected
    ? "connect wallet to distribute"
    : pending
      ? chainId !== BASE_CHAIN_ID
        ? "switching to base…"
        : phase === "snap"
          ? "snapshotting vault…"
          : phase === "push"
            ? `paying holders · ${progress.done} / ${progress.total}`
            : "working…"
      : holders.length === 0
        ? "snap (no holders to pay yet)"
        : `distribute to ${holders.length} holder${holders.length === 1 ? "" : "s"} →`;

  return (
    <div style={{ marginTop: 12 }}>
      <button
        type="button"
        className="btn primary"
        onClick={snap}
        disabled={!isConnected || pending}
        style={{ fontSize: 14 }}
      >
        {label}
      </button>
      {pending && phase === "push" ? (
        <div style={{ marginTop: 8, fontSize: 13, color: "var(--fg-2)" }}>
          one tx per holder · approve each in your wallet
        </div>
      ) : null}
      {error ? (
        <div style={{ marginTop: 8, color: "var(--red)", fontSize: 13 }}>{error}</div>
      ) : null}
    </div>
  );
}
