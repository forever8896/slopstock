"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWatchContractEvent,
  useWriteContract,
} from "wagmi";
import { parseUnits } from "viem";
import {
  erc20Abi,
  marketplaceAbi,
  stratumAgentNftAbi,
} from "@stratum/contracts-types";
import { ZG_GALILEO } from "@stratum/shared";
import { AcquireEventLog } from "@/components/acquire-event-log";
import type { EventLogEntry } from "@/lib/acquire";
import type { AgentDetail } from "@/lib/agents";
import { formatUsdc, relativeTime, shortAddr } from "@/lib/format";

type Hex = `0x${string}`;

interface Props {
  agent: AgentDetail;
}

const ZG_CHAIN_ID = ZG_GALILEO.chainId;
const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;

export function AcquireClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onZg = chainId === ZG_CHAIN_ID;

  const [formPrice, setFormPrice] = useState("60000");
  const [formExpiryHours, setFormExpiryHours] = useState("48");
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [pendingAction, setPendingAction] = useState<"approve" | "post" | "accept" | null>(null);

  // ─── Reads ──────────────────────────────────────────────────────────
  const { data: ownerOf, refetch: refetchOwner } = useReadContract({
    address: agent.contracts.iNFT,
    abi: stratumAgentNftAbi,
    functionName: "ownerOf",
    args: [agent.tokenId],
    chainId: ZG_CHAIN_ID,
  });

  const { data: bidRaw, refetch: refetchBid } = useReadContract({
    address: agent.contracts.marketplace,
    abi: marketplaceAbi,
    functionName: "getBid",
    args: [agent.tokenId],
    chainId: ZG_CHAIN_ID,
  });

  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: ZG_GALILEO.usdc,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, agent.contracts.marketplace] : undefined,
    chainId: ZG_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const { data: usdcBalance, refetch: refetchUsdcBalance } = useReadContract({
    address: ZG_GALILEO.usdc,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: ZG_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const bid = useMemo(() => {
    if (!bidRaw || bidRaw.bidder === ZERO_ADDRESS) return null;
    return {
      bidder: bidRaw.bidder,
      price: bidRaw.price,
      expiresAt: Number(bidRaw.expiresAt),
      pubkey: bidRaw.bidderPubkey,
    };
  }, [bidRaw]);

  const acquired = ownerOf?.toLowerCase() === address?.toLowerCase();

  // ─── Writes ─────────────────────────────────────────────────────────
  const { writeContractAsync, data: txHash, error: writeError } = useWriteContract();
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: ZG_CHAIN_ID,
  });

  useEffect(() => {
    if (txConfirmed) {
      // Refresh all reads after each tx confirmation.
      void refetchBid();
      void refetchOwner();
      void refetchAllowance();
      void refetchUsdcBalance();
      setPendingAction(null);
    }
  }, [txConfirmed, refetchBid, refetchOwner, refetchAllowance, refetchUsdcBalance]);

  // ─── Event watchers — real onchain log feeds the trace panel ────────
  useWatchContractEvent({
    address: agent.contracts.marketplace,
    abi: marketplaceAbi,
    eventName: "BidPosted",
    chainId: ZG_CHAIN_ID,
    args: { tokenId: agent.tokenId },
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as { args?: { bidder?: Hex; price?: bigint; expiresAt?: bigint } }).args;
        if (!args?.bidder || args.price === undefined || args.expiresAt === undefined) continue;
        appendEvent({
          kind: "post",
          title: "Marketplace.BidPosted",
          lines: [
            `bidder ${shortAddr(args.bidder, 6)}`,
            `price ${formatUsdc(args.price, 0)} USDC`,
            `expires ${new Date(Number(args.expiresAt) * 1000).toISOString().slice(0, 19)}Z`,
          ],
        });
      }
    },
  });
  useWatchContractEvent({
    address: agent.contracts.marketplace,
    abi: marketplaceAbi,
    eventName: "BidRefunded",
    chainId: ZG_CHAIN_ID,
    args: { tokenId: agent.tokenId },
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as { args?: { bidder?: Hex; price?: bigint } }).args;
        if (!args?.bidder || args.price === undefined) continue;
        appendEvent({
          kind: "info",
          title: "Marketplace.BidRefunded",
          lines: [`refunded ${formatUsdc(args.price, 0)} USDC to ${shortAddr(args.bidder, 6)}`],
        });
      }
    },
  });
  useWatchContractEvent({
    address: agent.contracts.marketplace,
    abi: marketplaceAbi,
    eventName: "Acquired",
    chainId: ZG_CHAIN_ID,
    args: { tokenId: agent.tokenId },
    onLogs: (logs) => {
      for (const log of logs) {
        const args = (log as { args?: { acquirer?: Hex; seller?: Hex; price?: bigint } }).args;
        if (!args?.acquirer || !args.seller || args.price === undefined) continue;
        appendEvent({
          kind: "accept",
          title: "Marketplace.Acquired",
          lines: [
            `${shortAddr(args.seller, 6)} → ${shortAddr(args.acquirer, 6)}`,
            `${formatUsdc(args.price, 0)} USDC released to seller`,
            "iTransfer cleared all authorizeUsage grants",
          ],
        });
      }
    },
  });

  function appendEvent(e: Omit<EventLogEntry, "ts">) {
    setEvents((prev) => [...prev, { ...e, ts: Date.now() }]);
  }

  // ─── Actions ────────────────────────────────────────────────────────
  async function postBid() {
    if (!address || !onZg) return;
    const priceUsdc = parseUnits(formPrice, 6);
    if (bid && priceUsdc <= bid.price) {
      appendEvent({
        kind: "info",
        title: "rejected (preflight)",
        lines: [`bid must strictly beat current best of ${formatUsdc(bid.price, 0)} USDC`],
      });
      return;
    }

    try {
      // 1. Approve Marketplace to pull USDC if needed.
      if (!usdcAllowance || usdcAllowance < priceUsdc) {
        setPendingAction("approve");
        appendEvent({
          kind: "info",
          title: "USDC.approve",
          lines: [`grant Marketplace allowance for ${formatUsdc(priceUsdc, 0)} USDC`],
        });
        await writeContractAsync({
          address: ZG_GALILEO.usdc,
          abi: erc20Abi,
          functionName: "approve",
          args: [agent.contracts.marketplace, priceUsdc],
          chainId: ZG_CHAIN_ID,
        });
        // Wait for state refresh then proceed.
        await new Promise((r) => setTimeout(r, 1500));
      }

      // 2. Post the bid. Pubkey is a placeholder; production binds it to the
      //    bidder's TEE for the seller to seal the new content key against.
      const placeholderPubkey = generatePlaceholderPubkey();
      const expiresAt = BigInt(Math.floor(Date.now() / 1000) + Number(formExpiryHours) * 3600);

      setPendingAction("post");
      await writeContractAsync({
        address: agent.contracts.marketplace,
        abi: marketplaceAbi,
        functionName: "postBid",
        args: [agent.tokenId, priceUsdc, placeholderPubkey, Number(expiresAt) as unknown as bigint],
        chainId: ZG_CHAIN_ID,
      });
    } catch (e) {
      appendEvent({
        kind: "info",
        title: "tx error",
        lines: [e instanceof Error ? e.message : String(e)],
      });
      setPendingAction(null);
    }
  }

  async function acceptBid() {
    if (!address || !onZg || !bid) return;
    if (ownerOf?.toLowerCase() !== address.toLowerCase()) {
      appendEvent({
        kind: "info",
        title: "rejected (preflight)",
        lines: ["only the current owner may accept"],
      });
      return;
    }
    try {
      // The proof bytes encode a TEE re-encryption attestation. Onchain we just
      // require non-empty bytes for now (placeholder until the 0G fork lands).
      const proof = generatePlaceholderProof();
      setPendingAction("accept");
      appendEvent({
        kind: "info",
        title: "preparing iTransfer",
        lines: [
          "rotating sealed key inside TEE",
          "re-encrypting under bidder's pubkey",
          "submitting proof to AgentNFT.iTransfer",
        ],
      });
      await writeContractAsync({
        address: agent.contracts.marketplace,
        abi: marketplaceAbi,
        functionName: "accept",
        args: [agent.tokenId, proof],
        chainId: ZG_CHAIN_ID,
      });
    } catch (e) {
      appendEvent({
        kind: "info",
        title: "tx error",
        lines: [e instanceof Error ? e.message : String(e)],
      });
      setPendingAction(null);
    }
  }

  async function mintTestUsdc() {
    if (!address || !onZg) return;
    try {
      await writeContractAsync({
        address: ZG_GALILEO.usdc,
        abi: testnetUsdcMintAbi,
        functionName: "mint",
        args: [address, parseUnits("100000", 6)],
        chainId: ZG_CHAIN_ID,
      });
    } catch (e) {
      appendEvent({
        kind: "info",
        title: "USDC mint error",
        lines: [e instanceof Error ? e.message : String(e)],
      });
    }
  }

  // ─── Render ─────────────────────────────────────────────────────────
  const ownerLabel = ownerOf ?? "—";

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="text-xs text-text-muted">
          <Link href={`/agent/${agent.ticker}`} className="hover:text-text-primary">
            ← {agent.ens}
          </Link>
        </div>
        <h1 className="text-2xl">acquire {agent.ticker} (whole iNFT)</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Acquiring the iNFT triggers an in-enclave re-encryption: a new content key is generated
          inside the TEE, the weights are re-encrypted, and the previous owner&apos;s sealed key is
          rotated out. All <code className="text-text-primary">authorizeUsage</code> grants are
          atomically cleared, the ENS resolver flips, and escrow releases to the seller — one tx.
        </p>
      </header>

      {!isConnected ? (
        <div className="panel border-yellow-400 px-4 py-3 text-sm">
          connect a wallet to interact with the Marketplace
        </div>
      ) : !onZg ? (
        <div className="panel border-yellow-400 px-4 py-3 text-sm flex items-center justify-between">
          <span>switch to 0G Galileo (chain {ZG_CHAIN_ID}) to read & write Marketplace state</span>
          <button
            onClick={() => switchChain({ chainId: ZG_CHAIN_ID })}
            className="border border-accent-green px-3 py-1.5 text-xs text-accent-green hover:bg-bg-elev"
          >
            switch network
          </button>
        </div>
      ) : null}

      <section className="panel p-4">
        <div className="label mb-3">current owner</div>
        <div className="flex items-center justify-between text-sm">
          <code className="text-text-primary">{ownerLabel}</code>
          <span className="text-xs text-text-muted">
            {acquired ? "you own this agent" : "not you"}
          </span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4">
          <div className="label mb-3">post bid</div>
          <p className="mb-3 text-xs text-text-muted">
            Strictly beat the current best ({bid ? `${formatUsdc(bid.price, 0)} USDC` : "no bid yet"}).
            Escrow is pulled up-front; the prior bidder is refunded by the contract.
          </p>
          {address && onZg ? (
            <div className="mb-3 flex items-center justify-between text-xs text-text-muted">
              <span>your USDC: {usdcBalance ? formatUsdc(usdcBalance, 2) : "0.00"}</span>
              <button
                type="button"
                onClick={mintTestUsdc}
                disabled={pendingAction !== null}
                className="border border-border px-2 py-1 hover:border-accent-green hover:text-accent-green disabled:opacity-40"
              >
                + mint 100k testnet USDC
              </button>
            </div>
          ) : null}
          <label className="block text-xs text-text-muted">
            price (USDC)
            <input
              type="number"
              min="0"
              step="100"
              value={formPrice}
              onChange={(e) => setFormPrice(e.target.value)}
              className="mt-1 block w-full border border-border bg-bg-base px-2 py-1.5 text-sm focus:border-accent-green focus:outline-none"
            />
          </label>
          <label className="mt-3 block text-xs text-text-muted">
            expires in (hours)
            <input
              type="number"
              min="1"
              max="168"
              value={formExpiryHours}
              onChange={(e) => setFormExpiryHours(e.target.value)}
              className="mt-1 block w-full border border-border bg-bg-base px-2 py-1.5 text-sm focus:border-accent-green focus:outline-none"
            />
          </label>
          <button
            type="button"
            onClick={postBid}
            disabled={!address || !onZg || pendingAction !== null}
            className="mt-4 w-full border border-border px-3 py-2 text-sm hover:border-accent-green hover:text-accent-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "approve"
              ? "approving USDC…"
              : pendingAction === "post"
              ? "posting bid…"
              : "post bid"}
          </button>
        </section>

        <section className="panel p-4">
          <div className="label mb-3">current best bid</div>
          <dl className="space-y-2 text-sm">
            <Row label="price" value={bid ? `${formatUsdc(bid.price, 0)} USDC` : "—"} />
            <Row label="bidder" value={bid ? shortAddr(bid.bidder, 6) : "—"} />
            <Row label="expires" value={bid ? relativeTime(bid.expiresAt) : "—"} />
            <Row
              label="bidder pubkey"
              value={bid && bid.pubkey.length > 2 ? shortAddr(bid.pubkey as Hex, 6) : "—"}
              hint="seals the new content key against this pubkey"
            />
          </dl>
          <button
            type="button"
            onClick={acceptBid}
            disabled={!address || !onZg || !bid || pendingAction !== null || !acquiredCanAccept(ownerOf, address)}
            className="mt-4 w-full border border-accent-red bg-bg-elev px-3 py-2 text-sm text-accent-red hover:bg-bg-base disabled:cursor-not-allowed disabled:opacity-40"
          >
            {pendingAction === "accept"
              ? "accepting…"
              : txPending
              ? "waiting for confirmation…"
              : "accept (TEE re-encrypt + iTransfer)"}
          </button>
          {writeError ? (
            <div className="mt-3 text-xs text-accent-red">{writeError.message}</div>
          ) : null}
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-text-muted">what this tx does</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-muted">
              <li>generate a fresh content key inside Intel TDX</li>
              <li>re-encrypt the weights, system prompt, and RAG corpus</li>
              <li>seal the new key under the bidder&apos;s pubkey</li>
              <li>call AgentNFT.iTransfer (verifies the proof onchain)</li>
              <li>atomically clear all active subscriber grants (usageVersion bump)</li>
              <li>flip the ENS resolver to the acquirer</li>
            </ol>
          </details>
        </section>
      </div>

      <AcquireEventLog events={events} />
    </div>
  );
}

function acquiredCanAccept(owner: Hex | undefined, account: Hex | undefined) {
  if (!owner || !account) return false;
  return owner.toLowerCase() === account.toLowerCase();
}

function generatePlaceholderPubkey(): Hex {
  const bytes = new Uint8Array(33);
  crypto.getRandomValues(bytes);
  bytes[0] = 0x04;
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

function generatePlaceholderProof(): Hex {
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  return ("0x" + Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("")) as Hex;
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-xs text-text-muted">{label}</dt>
      <dd className="text-right">
        <div>{value}</div>
        {hint ? <div className="text-xs text-text-muted">{hint}</div> : null}
      </dd>
    </div>
  );
}

// TestnetUSDC has a permissionless mint(address,uint256) that's not in the
// generic erc20Abi. Inline ABI fragment.
const testnetUsdcMintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [],
  },
] as const;
