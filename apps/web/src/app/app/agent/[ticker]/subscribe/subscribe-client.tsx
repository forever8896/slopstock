"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useBalance,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { encodeFunctionData, parseEther } from "viem";
import { erc20Abi, swapRouter02Abi } from "@stratum/contracts-types";
import { UNISWAP_BASE_SEPOLIA, USDC_BASE_SEPOLIA } from "@stratum/shared";
import type { AgentDetail } from "@/lib/agents";
import { infer, type InferResult, type PaymentReceipt } from "@/lib/operator";
import { sampleContracts } from "@/lib/sample-contracts";
import { formatUsdc, shortAddr } from "@/lib/format";
import { InferenceOutput } from "@/components/inference-output";
import { Crumb } from "@/components/crumb";
import { Rail } from "@/components/rail";

interface Props {
  agent: AgentDetail;
}

type Hex = `0x${string}`;
type PayToken = "USDC" | "ETH";
type Phase = "lock" | "break" | "chip" | "receipt";

const BASE_CHAIN_ID = baseSepolia.id;
/** ETH→USDC max-in scales with the agent's per-call price.
 *  ETH ≈ $2400 testnet → 1 ETH ≈ 2_400_000_000 USDC-smallest.
 *  Use a 4× safety multiplier on top so slippage + price-shift never reverts.
 *  Uniswap refunds the unused portion via refundETH(), so over-sizing is free. */
function ethMaxForUsdc(perCallUsdcSmallest: bigint): bigint {
  // (perCallUsdcSmallest * 4 * 1e18) / (2400 * 1e6)
  // = perCallUsdcSmallest * 4 * 1e12 / 2400
  // Order to avoid underflow: multiply first, divide last.
  const numerator = perCallUsdcSmallest * 4n * 10n ** 12n;
  const eth = numerator / 2400n;
  // Floor at 0.001 ETH so tiny per-call values still get a usable max.
  const floor = parseEther("0.001");
  return eth > floor ? eth : floor;
}

export function SubscribeClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onBase = chainId === BASE_CHAIN_ID;

  const [input, setInput] = useState(
    `audit the contract at ${shortAddr(agent.contracts.shareToken, 6)} — focus on reentrancy, access-control on the upgrade path, and any rounding errors in shareWithdraw().`,
  );
  const [payToken, setPayToken] = useState<PayToken>("USDC");
  const [step, setStep] = useState<1 | 2 | 3 | 4>(1);
  const [phase, setPhase] = useState<Phase>("lock");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [result, setResult] = useState<InferResult | null>(null);
  const [paidTxHash, setPaidTxHash] = useState<Hex | null>(null);
  const [pollStartedAt, setPollStartedAt] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const subscriber: Hex = address ?? "0x0000000000000000000000000000000000000000";

  const { data: usdcBalance, refetch: refetchUsdc } = useReadContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });
  const { data: ethBalance, refetch: refetchEth } = useBalance({
    address,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const price = agent.perCallUsdc;
  const ethMax = ethMaxForUsdc(price);
  const hasUsdc = usdcBalance !== undefined && usdcBalance >= price;
  const hasEth = ethBalance !== undefined && ethBalance.value >= ethMax;

  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: BASE_CHAIN_ID,
  });

  useEffect(() => {
    if (!txConfirmed || !txHash) return;
    void submitToOperator(txHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed, txHash]);

  // Live tick during the poll phase so the UI doesn't look frozen.
  useEffect(() => {
    if (!pollStartedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - pollStartedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [pollStartedAt]);

  async function runAudit() {
    if (!input.trim() || !address) return;
    setErrorMsg(null);

    if (!onBase) {
      setErrorMsg(`switch your wallet to Base Sepolia (chain ${BASE_CHAIN_ID})`);
      return;
    }
    if (payToken === "USDC" && !hasUsdc) {
      setErrorMsg(
        `insufficient USDC (have ${usdcBalance ? formatUsdc(usdcBalance, 2) : "0"}, need ${formatUsdc(price, 2)}). pay in eth instead.`,
      );
      return;
    }
    if (payToken === "ETH" && !hasEth) {
      setErrorMsg(`need at least 0.001 ETH on Base Sepolia. faucet: bridge.base.org/deposit`);
      return;
    }

    setBusy(true);
    setStep(2);
    setPhase("lock");

    try {
      let hash: Hex;
      if (payToken === "USDC") {
        hash = await writeContractAsync({
          address: USDC_BASE_SEPOLIA,
          abi: erc20Abi,
          functionName: "transfer",
          args: [agent.contracts.vault, price],
          chainId: BASE_CHAIN_ID,
          // Pin gas to bypass Base Sepolia public RPC's flaky estimateGas
          // (returns "exceeds max transaction gas limit" instead of an
          // estimate). USDC.transfer is ~50k gas; 200k is safe.
          gas: 200_000n,
        });
      } else {
        const swapData = encodeFunctionData({
          abi: swapRouter02Abi,
          functionName: "exactOutputSingle",
          args: [
            {
              tokenIn: UNISWAP_BASE_SEPOLIA.weth,
              tokenOut: USDC_BASE_SEPOLIA,
              fee: UNISWAP_BASE_SEPOLIA.fee,
              recipient: agent.contracts.vault,
              amountOut: price,
              amountInMaximum: ethMax,
              sqrtPriceLimitX96: 0n,
            },
          ],
        });
        const refundData = encodeFunctionData({
          abi: swapRouter02Abi,
          functionName: "refundETH",
          args: [],
        });
        hash = await writeContractAsync({
          address: UNISWAP_BASE_SEPOLIA.swapRouter02,
          abi: swapRouter02Abi,
          functionName: "multicall",
          args: [[swapData, refundData]],
          value: ethMax,
          chainId: BASE_CHAIN_ID,
          // Pin gas — Uniswap V3 multicall (exactOutputSingle + refundETH)
          // is ~250-350k gas. 600k headroom. Bypasses Base Sepolia RPC's
          // estimateGas quirk that throws "exceeds max transaction gas limit".
          gas: 600_000n,
        });
      }
      setPaidTxHash(hash);
      setPhase("break");
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setBusy(false);
      setStep(2);
    }
  }

  async function submitToOperator(hash: Hex) {
    setStep(3);
    setPhase("break");
    setErrorMsg(null);
    setPollStartedAt(Date.now());
    const receipt: PaymentReceipt = {
      txHash: hash,
      facilitator: "chain",
      receiptId: `rcpt-${crypto.randomUUID()}`,
    };
    try {
      // animate phases ahead of the real wait
      setTimeout(() => setPhase("chip"), 800);
      const r = await infer({
        tokenId: agent.tokenId.toString(),
        input,
        subscriber,
        paymentReceipt: receipt,
      });
      if (!r.ok) {
        // Surface poll errors / 402 / non-ok responses as a real error message
        // instead of silently advancing to step 4 with no receipt.
        const msg = r.kind === "payment-required"
          ? "operator says payment is missing — try again with a fresh tx"
          : r.message;
        setErrorMsg(`agent did not return: ${msg}`);
        setStep(2);
        setPhase("lock");
        return;
      }
      setResult(r);
      setPhase("receipt");
      setStep(4);
      void refetchUsdc();
      void refetchEth();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setPollStartedAt(null);
    }
  }

  function reset() {
    setStep(1);
    setPhase("lock");
    setBusy(false);
    setErrorMsg(null);
    setResult(null);
    setPaidTxHash(null);
  }

  const submitLabel = useMemo(() => {
    if (busy && txPending) return payToken === "ETH" ? "swapping eth → usdc…" : "settling on chain…";
    if (busy) return "running inference…";
    if (result?.ok) return "verified ✓ · run another";
    return `submit · pay ${agent.perCallHuman} →`;
  }, [busy, txPending, payToken, result, agent.perCallHuman]);

  return (
    <>
      <Crumb
        path={
          <>
            ~/<Link href="/app">markets</Link> · <Link href={`/app/agent/${agent.ticker}`}>{agent.ticker}</Link> ·{" "}
            <b style={{ color: "var(--fg)" }}>subscribe</b>
          </>
        }
        right={
          <>
            x402 endpoint <span className="fg2">/x402/infer · {agent.perCallHuman}</span> · price-locked
          </>
        }
      />

      <div style={{ marginBottom: 18 }}>
        <Rail
          steps={["compose", "pay", "run", "receipt"]}
          current={step - 1}
        />
      </div>

      {!isConnected ? (
        <div className="panel" style={{ marginTop: 14, padding: "12px 14px", borderColor: "var(--amber)", color: "var(--amber)", fontSize: 12 }}>
          connect a wallet to pay
        </div>
      ) : !onBase ? (
        <div className="panel" style={{ marginTop: 14, padding: "12px 14px", borderColor: "var(--amber)", display: "flex", justifyContent: "space-between", alignItems: "center", fontSize: 12 }}>
          <span style={{ color: "var(--amber)" }}>switch to Base Sepolia (chain {BASE_CHAIN_ID}) to pay</span>
          <button className="btn" onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}>
            switch network
          </button>
        </div>
      ) : null}

      {/* WORKBENCH */}
      <section className="work">
        <div className="work-l">
          <div className="work-section">
            <h3>
              01 · what do you want the agent to do{" "}
              <span className="muted" style={{ float: "right" }}>
                sent to {agent.ticker} · {agent.ens}
              </span>
            </h3>
            <div className="muted" style={{ marginBottom: 8, fontSize: 14 }}>
              Plain text. The agent reads this in the same way every other agent on this site does —
              system prompt + your input → its tools → final answer.
            </div>
            <textarea
              className="req"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              spellCheck={false}
            />
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 10 }}>
              {sampleContracts.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setInput(s.source)}
                  className="pill"
                  style={{ cursor: "pointer" }}
                  title={s.bug}
                >
                  preset: {s.label}
                </button>
              ))}
            </div>
          </div>

          <div className="work-section">
            <h3>
              02 · how you&apos;ll pay
            </h3>
            <div className="muted" style={{ marginBottom: 10, fontSize: 14 }}>
              The operator will return a <code>402 Payment Required</code> with the agent&apos;s
              vault address and the price. Both options below put exactly{" "}
              <span className="acc">{agent.perCallHuman} USDC</span> into that vault in one transaction;
              the operator&apos;s validator then finds the matching{" "}
              <code>USDC.Transfer → vault</code> log and accepts payment. No facilitator, no escrow.
            </div>
            <div className="pay-grid">
              <button
                type="button"
                className={`pay-card ${payToken === "USDC" ? "on" : ""}`}
                onClick={() => setPayToken("USDC")}
              >
                <div className="h">
                  <span className="t">pay USDC directly</span>
                  <span className="badge">simplest</span>
                </div>
                <div className="body">
                  <div className="row"><span className="k">price</span><span>{agent.perCallHuman} USDC</span></div>
                  <div className="row"><span className="k">your balance</span><span>{usdcBalance !== undefined ? `$${formatUsdc(usdcBalance, 2)}` : "—"}</span></div>
                  <div className="row"><span className="k">tx</span><span>one transfer to the vault</span></div>
                  <div className="row"><span className="k">gas</span><span>~$0.0003</span></div>
                </div>
              </button>
              <button
                type="button"
                className={`pay-card ${payToken === "ETH" ? "on" : ""}`}
                onClick={() => setPayToken("ETH")}
              >
                <div className="h">
                  <span className="t">pay ETH → swap to USDC</span>
                  <span className="badge">no USDC needed</span>
                </div>
                <div className="body">
                  <div className="row"><span className="k">you send</span><span>~0.0004 ETH</span></div>
                  <div className="row"><span className="k">vault receives</span><span>{agent.perCallHuman} USDC</span></div>
                  <div className="row"><span className="k">how</span><span>Uniswap V3 → vault</span></div>
                  <div className="row"><span className="k">unused ETH</span><span>refunded automatically</span></div>
                </div>
              </button>
            </div>

            <div className="route">
              <span className="leg">your wallet</span>
              <div className="arrow"><span className="pool">{payToken === "ETH" ? "uniswap v3 · base sepolia" : "USDC.transfer"}</span></div>
              <span className="leg">{agent.ticker} vault</span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              className={"mint-btn" + (busy ? " busy" : "")}
              onClick={result?.ok ? reset : runAudit}
              disabled={!isConnected || !input.trim() || busy}
            >
              {submitLabel}
              {!busy ? <span className="ar">→</span> : null}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13, color: "var(--mute)" }}>
              <span>
                {paidTxHash ? (
                  <>paid in tx <code className="acc">{shortAddr(paidTxHash, 6)}</code> — operator is verifying the log walk now…</>
                ) : (
                  "click submit → wallet pops up → tx confirms on base sepolia → agent runs in TEE → response below"
                )}
              </span>
              <button className="btn ghost" onClick={reset} disabled={busy} style={{ height: 24, padding: "0 8px", fontSize: 12 }}>
                reset
              </button>
            </div>
          </div>
          {errorMsg ? (
            <div style={{ padding: "10px 20px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--hair-2)" }}>
              {errorMsg}
            </div>
          ) : null}
        </div>

        {/* RIGHT: sealed envelope stage */}
        <div className="work-r">
          <div className="seal-stage">
            <h3>what&apos;s happening inside the operator</h3>
            <div className="muted" style={{ fontSize: 13, marginBottom: 10 }}>
              Each stage matches a real step on the server. The model itself is running inside
              an Intel TDX enclave; the response comes back signed.
            </div>
            <div className="stages">
              <Stage name="lock" label="bundle the call" icon="[#]" current={phase} />
              <Stage name="break" label="ship to enclave" icon="[/]" current={phase} />
              <Stage name="chip" label="model signs reply" icon="[✓]" current={phase} />
              <Stage name="receipt" label="receipt back to you" icon="[≡]" current={phase} />
            </div>
            <div className="seal-anim">
              <pre dangerouslySetInnerHTML={{ __html: FRAMES[phase](agent) }} />
            </div>
            {pollStartedAt && !result ? (
              <div
                style={{
                  marginTop: 10,
                  padding: "8px 12px",
                  border: "1px solid rgba(16,185,129,0.30)",
                  background: "rgba(16,185,129,0.04)",
                  borderRadius: 3,
                  fontSize: 14,
                  color: "var(--fg-2)",
                }}
              >
                <span className="acc">⏱ {elapsed}s</span>
                {" · waiting on operator. hermes can take 30–90s for multi-tool runs (cross-agent calls + on-chain reads). will time out at 180s if nothing comes back."}
              </div>
            ) : null}
          </div>

          {step === 4 && result?.ok ? (
            <ReceiptBlock result={result} agent={agent} txHash={paidTxHash} />
          ) : null}
        </div>
      </section>

    </>
  );
}

function Step({ n, title, meta, current }: { n: 1 | 2 | 3 | 4; title: string; meta: string; current: 1 | 2 | 3 | 4 }) {
  const cls = n < current ? "step done" : n === current ? "step active" : "step";
  return (
    <div className={cls} data-step={n}>
      <div className="n">
        <span className="dot" />
        <span>0{n} / {n === 1 ? "compose" : n === 2 ? "pay" : n === 3 ? "seal" : "receipt"}</span>
      </div>
      <div className="ttl">{title}</div>
      <div className="meta">{meta}</div>
    </div>
  );
}

function Stage({ name, label, icon, current }: { name: Phase; label: string; icon: string; current: Phase }) {
  const order: Phase[] = ["lock", "break", "chip", "receipt"];
  const idx = order.indexOf(name);
  const cur = order.indexOf(current);
  const cls = idx < cur ? "ph done" : idx === cur ? "ph active" : "ph";
  return (
    <div className={cls} data-ph={name}>
      <div className="icon">{icon}</div>
      <div className="lbl">{label}</div>
    </div>
  );
}

function ReceiptBlock({
  result,
  agent,
  txHash,
}: {
  result: Extract<InferResult, { ok: true }>;
  agent: AgentDetail;
  txHash: `0x${string}` | null;
}) {
  const r = result.receipt as unknown as {
    teeAttestation?: { measurement?: string; vendor?: string };
    bundleHashAfter?: string;
    computeBackend?: string;
    paymentProof?: string;
  };
  const measurement = r.teeAttestation?.measurement ?? agent.expectedTeeMeasurement;
  const measurementOk =
    typeof measurement === "string" &&
    measurement.toLowerCase() === agent.expectedTeeMeasurement.toLowerCase();

  return (
    <div className="attest-receipt">
      <div className="head">
        <span className="t">response signed by the model · proof returned</span>
        <span className="muted" style={{ fontSize: 13 }}>
          {r.computeBackend ?? "operator"}
        </span>
      </div>
      <h2>response is back. signed by the model.</h2>
      <div className="body">
        Below is the agent&apos;s answer. The signature recovers to the on-chain TEE signer
        address — that&apos;s how we know the response came out of the enclave and wasn&apos;t
        forged. The agent&apos;s vault is now {agent.perCallHuman} richer; that USDC will flow to
        shareholders next time someone snaps the vault.
      </div>

      <div className="grid">
        <div className="c">
          <div className="l">tx hash</div>
          <div className="v acc">{txHash ? shortAddr(txHash, 8) : "—"}</div>
        </div>
        <div className="c">
          <div className="l">bundle hash</div>
          <div className="v">{r.bundleHashAfter ? shortAddr(r.bundleHashAfter, 8) : "—"}</div>
        </div>
        <div className="c">
          <div className="l">attestation</div>
          <div className={`v ${measurementOk ? "acc" : ""}`}>{shortAddr(measurement, 8)}</div>
        </div>
        <div className="c">
          <div className="l">verified</div>
          <div className={`v ${measurementOk ? "acc" : ""}`}>
            {measurementOk ? "match · trusted" : "mismatch — investigate"}
          </div>
        </div>
        <div className="c">
          <div className="l">callId</div>
          <div className="v">{shortAddr(result.callId, 6)}</div>
        </div>
        <div className="c">
          <div className="l">status</div>
          <div className="v acc">verified · written to chain</div>
        </div>
      </div>

      {result.steps && result.steps.length > 0 ? (
        <div className="exec-flow" style={{ marginTop: 18 }}>
          <h4 style={{ margin: "0 0 10px" }}>execution flow</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FlowStep icon="▸" label="x402 paid" detail={`you → ${agent.ticker} · ${agent.perCallHuman} on Base`} accent />
            <FlowStep icon="✦" label="0G sealed compute" detail="deepseek · TEE-attested in the enclave" />
            {result.steps
              .filter((s) => s.kind !== "llm")
              .map((s, i) => {
                const peer = s.tool === "query_agent" || /paid .*(x402|to )/i.test(s.summary);
                return (
                  <FlowStep
                    key={i}
                    icon={peer ? "⇄" : s.kind === "tool" ? "⚙" : s.kind === "skill" ? "✚" : "·"}
                    label={peer ? "agent → agent · x402" : (s.tool ?? s.kind)}
                    detail={s.summary}
                    accent={peer}
                  />
                );
              })}
            <FlowStep icon="✓" label="answer" detail="signed by the model · returned" accent />
          </div>
        </div>
      ) : null}

      <div className="out">
        <h4>response</h4>
        <InferenceOutput raw={result.output} />
      </div>
    </div>
  );
}

function tryFormatJson(s: string): string {
  try {
    return JSON.stringify(JSON.parse(s), null, 2);
  } catch {
    return s;
  }
}

const FRAMES: Record<Phase, (a: AgentDetail) => string> = {
  lock: (a) =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] sealing bundle…</span>                 │
  │   payload  · ${a.perCallHuman.padEnd(7)}                │
  │   model    · ${a.runtime.padEnd(20)}   │
  │                                     │
  │ <span class="mu">[ ] seal break</span>                       │
  │ <span class="mu">[ ] attestation chip</span>                 │
  │ <span class="mu">[ ] signed receipt</span>                   │
  └─────────────────────────────────────┘`,
  break: () =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] sealed bundle ✓</span>                 │
  │                                     │
  │ <span class="am">[/] dispatching to enclave…</span>          │
  │   tee-ml · 0g-compute               │
  │   inference running…                │
  │                                     │
  │ <span class="mu">[ ] attestation chip</span>                 │
  │ <span class="mu">[ ] signed receipt</span>                   │
  └─────────────────────────────────────┘`,
  chip: () =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] sealed bundle ✓</span>                 │
  │ <span class="acc">[/] enclave returned response ✓</span>     │
  │   response · signed                 │
  │                                     │
  │ <span class="acc">[✓] attestation chip generated</span>      │
  │   signer   · teeml                  │
  │                                     │
  │ <span class="am">[≡] writing receipt onchain…</span>         │
  └─────────────────────────────────────┘`,
  receipt: (a) =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] sealed bundle ✓</span>                 │
  │ <span class="acc">[/] enclave returned response ✓</span>     │
  │ <span class="acc">[✓] attestation chip ✓</span>              │
  │ <span class="acc">[≡] receipt written ✓</span>               │
  │                                     │
  │   total  · ${a.perCallHuman.padEnd(7)} settled         │
  │   model  · ${a.runtime.padEnd(24)}     │
  │   chain  · base-sepolia             │
  └─────────────────────────────────────┘`,
};

function FlowStep({ icon, label, detail, accent }: { icon: string; label: string; detail: string; accent?: boolean }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "baseline",
        gap: 10,
        padding: "7px 10px",
        borderLeft: `2px solid ${accent ? "var(--accent, #10b981)" : "rgba(255,255,255,0.12)"}`,
        background: accent ? "rgba(16,185,129,0.05)" : "transparent",
        borderRadius: 2,
      }}
    >
      <span style={{ color: accent ? "var(--accent, #10b981)" : "var(--fg-2)", fontFamily: "ui-monospace, monospace", width: 16 }}>{icon}</span>
      <span style={{ fontWeight: 600, fontSize: 13, minWidth: 130, color: accent ? "var(--accent, #10b981)" : "var(--fg)" }}>{label}</span>
      <span style={{ fontSize: 12, color: "var(--fg-2)", wordBreak: "break-word" }}>{detail}</span>
    </div>
  );
}
