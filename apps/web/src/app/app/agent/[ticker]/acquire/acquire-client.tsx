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
import { baseSepolia } from "wagmi/chains";
import { parseUnits } from "viem";
import { erc20Abi, ipoSaleAbi } from "@stratum/contracts-types";
import { USDC_BASE_SEPOLIA } from "@stratum/shared";
import type { AgentDetail } from "@/lib/agents";
import { formatShares, formatUsdc, pctOf, relativeTime, shortAddr } from "@/lib/format";

type Hex = `0x${string}`;

interface Props {
  agent: AgentDetail;
}

interface BlotterRow {
  id: string;
  ts: number;
  status: "ok" | "pending" | "fail";
  label: string;
  hash?: Hex;
}

const BASE_CHAIN_ID = baseSepolia.id;
const PROTOCOL_FEE = 0.005;

export function AcquireClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onBase = chainId === BASE_CHAIN_ID;

  const [qty, setQty] = useState(500);
  const [pendingAction, setPendingAction] = useState<"approve" | "buy" | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [synthRows, setSynthRows] = useState<BlotterRow[]>([]);

  // Mirror the cap-table reads from the agent loader.
  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  const { data: usdcAllowance, refetch: refetchAllowance } = useReadContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "allowance",
    args: address ? [address, agent.contracts.ipoSale] : undefined,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: BASE_CHAIN_ID,
  });

  useEffect(() => {
    if (txConfirmed) {
      setPendingAction(null);
      void refetchUsdc();
      void refetchAllowance();
    }
  }, [txConfirmed, refetchUsdc, refetchAllowance]);

  // Real on-chain Bought events feed the blotter.
  const [chainRows, setChainRows] = useState<BlotterRow[]>([]);
  useWatchContractEvent({
    address: agent.contracts.ipoSale,
    abi: ipoSaleAbi,
    eventName: "Bought",
    chainId: BASE_CHAIN_ID,
    onLogs: (logs) => {
      const next: BlotterRow[] = [];
      for (const log of logs) {
        const args = (log as { args?: { buyer?: Hex; amount?: bigint; cost?: bigint }; transactionHash?: Hex }).args;
        const hash = (log as { transactionHash?: Hex }).transactionHash;
        if (!args?.buyer || args.amount === undefined || args.cost === undefined) continue;
        next.push({
          id: `${hash}-${args.buyer}`,
          ts: Date.now(),
          status: "ok",
          label: `${shortAddr(args.buyer, 6)} filled ${formatShares(args.amount, 0)} sh · $${formatUsdc(args.cost, 2)}`,
          hash,
        });
      }
      if (next.length) setChainRows((prev) => [...next, ...prev]);
    },
  });

  // ─── Derived values ─────────────────────────────────────────────────
  const pricePerShare = agent.ipo.pricePerShareUsdc; // USDC smallest units
  const remaining = agent.ipo.allocation > agent.ipo.sold ? agent.ipo.allocation - agent.ipo.sold : 0n;
  const totalUsd = useMemo(() => {
    // Pre-fee USD: qty * pricePerShare (USDC smallest), divided by 10^6 to get USD.
    // qty is plain number; pricePerShare is bigint.
    const subSmallest = BigInt(qty) * pricePerShare;
    return Number(subSmallest) / 1e6;
  }, [qty, pricePerShare]);
  const fee = totalUsd * PROTOCOL_FEE;
  const total = totalUsd + fee;

  const soldPct = pctNum(agent.ipo.sold, agent.ipo.allocation);
  const raisedUsd =
    Number((agent.ipo.sold / 10n ** 18n) * pricePerShare) / 1e6;
  const targetUsd =
    Number((agent.ipo.allocation / 10n ** 18n) * pricePerShare) / 1e6;

  const blotter = [...synthRows, ...chainRows].slice(0, 12);

  // ─── Actions ────────────────────────────────────────────────────────
  async function buy() {
    if (!address || !onBase) return;
    setErrorMsg(null);
    const sharesWei = parseUnits(String(qty), 18);
    const costSmallest = BigInt(qty) * pricePerShare;

    const synthId = crypto.randomUUID();
    setSynthRows((r) => [
      {
        id: synthId,
        ts: Date.now(),
        status: "pending",
        label: `you · ${shortAddr(address, 6)} · pending · ${qty} sh · $${total.toFixed(2)}`,
      },
      ...r,
    ]);

    try {
      // 1. Approve if needed.
      if (!usdcAllowance || usdcAllowance < costSmallest) {
        setPendingAction("approve");
        await writeContractAsync({
          address: USDC_BASE_SEPOLIA,
          abi: erc20Abi,
          functionName: "approve",
          args: [agent.contracts.ipoSale, costSmallest],
          chainId: BASE_CHAIN_ID,
          gas: 100_000n,
        });
        await new Promise((r) => setTimeout(r, 1500));
      }

      // 2. Buy.
      setPendingAction("buy");
      const hash = await writeContractAsync({
        address: agent.contracts.ipoSale,
        abi: ipoSaleAbi,
        functionName: "buy",
        args: [sharesWei],
        chainId: BASE_CHAIN_ID,
        gas: 400_000n,
      });

      setSynthRows((r) =>
        r.map((row) =>
          row.id === synthId
            ? {
                ...row,
                status: "ok",
                hash,
                label: `you · ${shortAddr(address, 6)} filled ${qty} sh · $${total.toFixed(2)} · erc-20 minted`,
              }
            : row,
        ),
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(msg);
      setSynthRows((r) =>
        r.map((row) =>
          row.id === synthId
            ? { ...row, status: "fail", label: `you · reverted · ${msg.slice(0, 60)}` }
            : row,
        ),
      );
      setPendingAction(null);
    }
  }

  function fmtUsd(n: number) {
    return `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }

  return (
    <>
      <div className="crumb">
        <Link href="/app">markets</Link> <span className="muted">/</span>{" "}
        <Link href={`/app/agent/${agent.ticker}`}>{agent.ticker}</Link>{" "}
        <span className="muted">/</span> <span className="acc">acquire</span>
        <span style={{ float: "right", color: "var(--mute-2)" }}>
          share contract <span className="fg2">{shortAddr(agent.contracts.shareToken, 6)}</span> ·{" "}
          {formatShares(agent.ipo.allocation, 0)} cap
        </span>
      </div>

      <section className="ipo-hero">
        <div className="ipo-h1">
          <span className="tk">{agent.ticker}</span>
          <span className="ens">{agent.ens} · share IPO</span>
          <span className={`pill ${agent.ipo.isOpen ? "ok" : ""}`}>● {agent.ipo.isOpen ? "open" : "closed"}</span>
          <span className="pill">
            {agent.ipo.isOpen ? `closes ${relativeTime(agent.ipo.endsAt)}` : `closed ${relativeTime(agent.ipo.endsAt)}`}
          </span>
        </div>
        <div style={{ color: "var(--fg-2)", fontSize: 15, marginTop: 4, marginBottom: 14 }}>
          You pay USDC, the creator receives it, you receive ERC-20 shares of {agent.ticker}.
          From this block forward, every snap of the agent&apos;s vault pays you a slice of the
          revenue weighted by how many shares you hold.
        </div>

        <div className="fundraise">
          <div className="nums">
            <span className="big">{formatShares(agent.ipo.sold, 0)}</span>
            <span className="of">
              / {formatShares(agent.ipo.allocation, 0)} shares · {pctOf(agent.ipo.sold, agent.ipo.allocation, 1)}
            </span>
          </div>
          <div className="meta">
            <div>
              raised <span className="acc" style={{ fontSize: 14 }}>{fmtUsd(raisedUsd)}</span> /{" "}
              {fmtUsd(targetUsd)}
            </div>
            <div className="muted">
              avg fill — · {/* total holders not in scope */}
              cap {formatShares(agent.ipo.allocation, 0)} sh
            </div>
          </div>
        </div>

        <div className="tape-big">
          <div className="fill" style={{ width: `${soldPct}%` }} />
          <div className="ticks">
            {Array.from({ length: 20 }).map((_, i) => <span key={i} />)}
          </div>
          <div className="lhs">[{ascii(soldPct, 20)}] {soldPct.toFixed(1)}%</div>
          <div className="pct">
            {formatShares(agent.ipo.sold, 0)} / {formatShares(agent.ipo.allocation, 0)} sh
          </div>
        </div>
        <div className="scale">
          {["0%", "10", "20", "30", "40", "50", "60", "70", "80", "90", "100"].map((s) => (
            <span key={s}>{s}</span>
          ))}
        </div>

        <div className="ipo-stats">
          <Stat l="price / share" v={`$${formatUsdc(agent.ipo.pricePerShareUsdc, 2)}`} sub="usdc · locked" />
          <Stat l="remaining" v={formatShares(remaining, 0)} sub="sh" />
          <Stat l="min · max" v="1 · 5,000" sub="sh / wallet" />
          <Stat l="post-ipo apy" v="≈ revenue-based" sub="distributed pro-rata" accent />
        </div>
      </section>

      <section className="acq-grid">
        <div className="qty-box">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
            <h3 style={{ margin: 0, fontSize: 14, letterSpacing: "0.22em", textTransform: "uppercase", color: "var(--mute)", fontWeight: 500 }}>
              pick how many shares you want
            </h3>
            <span className="muted" style={{ fontSize: 14 }}>
              fills against {shortAddr(agent.contracts.shareToken, 6)}
            </span>
          </div>
          <div className="muted" style={{ fontSize: 14, marginTop: 6 }}>
            Two transactions: approve USDC → buy. The IPOSale contract pulls your USDC,
            transfers shares to you in the same call, never custodies anything.
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="up">share count</div>
            <div className="qty-input" style={{ marginTop: 6 }}>
              <button onClick={() => setQty(Math.max(1, qty - 100))}>−</button>
              <input
                type="number"
                min="1"
                max="5000"
                step="10"
                value={qty}
                onChange={(e) => setQty(Math.max(1, Math.min(5000, parseInt(e.target.value || "0", 10))))}
              />
              <button onClick={() => setQty(Math.min(5000, qty + 100))}>+</button>
            </div>
            <div className="preset-row">
              {[100, 500, 1000, 2500, 5000].map((q) => (
                <button key={q} onClick={() => setQty(q)}>
                  {q === 5000 ? "max · 5,000" : q.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="cost-kv">
            <CostRow k="share count" v={qty.toLocaleString()} />
            <CostRow k="price / share" v={`$${formatUsdc(pricePerShare, 2)} usdc`} />
            <CostRow k="subtotal" v={fmtUsd(totalUsd)} />
            <CostRow k={`protocol fee · ${(PROTOCOL_FEE * 100).toFixed(2)}%`} v={fmtUsd(fee)} />
            <CostRow k="network" v="~$0.0004" />
            <div className="row total">
              <div className="k">total · pay & mint</div>
              <div className="v">{fmtUsd(total)}</div>
            </div>
          </div>

          <div style={{ marginTop: 14, fontSize: 14, color: "var(--mute)", lineHeight: 1.55 }}>
            shares hit your wallet in the same tx · you start earning revenue from the next snap
          </div>

          <div style={{ display: "flex", gap: 10, marginTop: 18, flexWrap: "wrap", alignItems: "center" }}>
            {!isConnected ? (
              <span className="pill warn">connect wallet to mint</span>
            ) : !onBase ? (
              <button className="btn" onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}>
                switch to base-sepolia
              </button>
            ) : (
              <button
                className="btn primary"
                onClick={buy}
                disabled={pendingAction !== null || !agent.ipo.isOpen}
              >
                {pendingAction === "approve"
                  ? "approving usdc…"
                  : pendingAction === "buy"
                    ? txPending ? "minting…" : "submitting…"
                    : agent.ipo.isOpen
                      ? `pay & mint ${qty.toLocaleString()} sh →`
                      : "ipo closed"}
              </button>
            )}
            <Link className="btn" href={`/app/agent/${agent.ticker}`}>view holder table</Link>
            <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--mute)" }}>
              slippage 0% · price-locked window
            </span>
          </div>
          {address && onBase ? (
            <div style={{ marginTop: 10, fontSize: 11, color: "var(--mute)" }}>
              your usdc:{" "}
              <span className="fg2">
                ${usdcBalance ? formatUsdc(usdcBalance, 2) : "0.00"}
              </span>{" "}
              · allowance:{" "}
              <span className="fg2">
                ${usdcAllowance ? formatUsdc(usdcAllowance, 2) : "0.00"}
              </span>
            </div>
          ) : null}
          {errorMsg ? (
            <div style={{ marginTop: 10, color: "var(--red)", fontSize: 12 }}>{errorMsg}</div>
          ) : null}
        </div>

        <div className="panel">
          <div className="panel-head">
            <div className="lhs">
              <span>fills · streaming live</span>
              <span className="tag muted">every Bought event from the IPOSale contract</span>
            </div>
            <div className="rhs">
              <span className="pill ok">live</span>
            </div>
          </div>
          <div className="blotter">
            {blotter.length === 0 ? (
              <div className="blot-row" style={{ borderBottom: 0 }}>
                <span className="ts">—</span>
                <span className="glyph">·</span>
                <span className="body muted">no fills yet · be the first</span>
                <span />
              </div>
            ) : (
              blotter.map((r) => (
                <div key={r.id} className={`blot-row ${r.status}`}>
                  <span className="ts">
                    {new Date(r.ts).toISOString().slice(11, 19)}
                  </span>
                  <span className="glyph">{r.status === "ok" ? "▸" : r.status === "pending" ? "·" : "×"}</span>
                  <span className="body" dangerouslySetInnerHTML={{ __html: r.label.replace(/\b(filled|pending|reverted)\b/, '<b>$1</b>') }} />
                  <span className="hash">{r.hash ? shortAddr(r.hash, 4) : "—"}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

    </>
  );
}

function Stat({ l, v, sub, accent }: { l: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className="c">
      <div className="l">{l}</div>
      <div className="v" style={accent ? { color: "var(--accent)", fontSize: 16 } : undefined}>
        {v} {sub ? <small>{sub}</small> : null}
      </div>
    </div>
  );
}

function CostRow({ k, v }: { k: string; v: string }) {
  return (
    <div className="row">
      <div className="k">{k}</div>
      <div className="v">{v}</div>
    </div>
  );
}

function pctNum(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  const permille = Number((num * 1000n) / den);
  return Math.min(100, Math.max(0, permille / 10));
}

function ascii(pct: number, n: number): string {
  const filled = Math.round((pct / 100) * n);
  return "█".repeat(Math.max(0, filled)) + "░".repeat(Math.max(0, n - filled));
}
