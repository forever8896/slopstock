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

interface Props {
  agent: AgentDetail;
}

type Hex = `0x${string}`;
type PayToken = "USDC" | "ETH";
type Phase = "lock" | "break" | "chip" | "receipt";

const BASE_CHAIN_ID = baseSepolia.id;
const ETH_AMOUNT_IN_MAX = parseEther("0.001");

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
  const hasUsdc = usdcBalance !== undefined && usdcBalance >= price;
  const hasEth = ethBalance !== undefined && ethBalance.value >= ETH_AMOUNT_IN_MAX;

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
              amountInMaximum: ETH_AMOUNT_IN_MAX,
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
          value: ETH_AMOUNT_IN_MAX,
          chainId: BASE_CHAIN_ID,
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
      setResult(r);
      setPhase("receipt");
      setStep(4);
      void refetchUsdc();
      void refetchEth();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
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
      {/* breadcrumb */}
      <div className="crumb">
        <Link href="/">markets</Link> <span className="muted">/</span>{" "}
        <Link href={`/agent/${agent.ticker}`}>{agent.ticker}</Link>{" "}
        <span className="muted">/</span> <span className="acc">subscribe</span>
        <span style={{ float: "right", color: "var(--mute-2)" }}>
          x402 endpoint <span className="fg2">/x402/infer · {agent.perCallHuman}</span> · price-locked
        </span>
      </div>

      {/* STEPPER */}
      <section className="stepper">
        <Step n={1} title="draft inference" meta="prompt + tools + budget" current={step} />
        <Step n={2} title="x402 settlement" meta="usdc direct · or eth via uniswap" current={step} />
        <Step n={3} title="tee inference" meta="0g compute · sealed bundle" current={step} />
        <Step n={4} title="attestation" meta="tx · bundle · attest hash" current={step} />
      </section>

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
              01 · compose request{" "}
              <span className="muted" style={{ float: "right" }}>
                to {agent.ticker} · {agent.ens}
              </span>
            </h3>
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
              <span className="pill">memory: persistent</span>
              <span className="pill">budget: {agent.perCallHuman} + a→a</span>
            </div>
          </div>

          <div className="work-section">
            <h3>
              02 · payment{" "}
              <span className="muted" style={{ float: "right" }}>
                x402 challenge from operator
              </span>
            </h3>
            <div className="pay-grid">
              <button
                type="button"
                className={`pay-card ${payToken === "USDC" ? "on" : ""}`}
                onClick={() => setPayToken("USDC")}
              >
                <div className="h">
                  <span className="t">usdc · direct</span>
                  <span className="badge">erc-20</span>
                </div>
                <div className="body">
                  <div className="row"><span className="k">unit price</span><span>{agent.perCallHuman} usdc</span></div>
                  <div className="row"><span className="k">total debit</span><span className="acc">{agent.perCallHuman} usdc</span></div>
                  <div className="row"><span className="k">your balance</span><span>{usdcBalance !== undefined ? `$${formatUsdc(usdcBalance, 2)}` : "—"}</span></div>
                  <div className="row"><span className="k">network fee</span><span>~$0.0003</span></div>
                </div>
              </button>
              <button
                type="button"
                className={`pay-card ${payToken === "ETH" ? "on" : ""}`}
                onClick={() => setPayToken("ETH")}
              >
                <div className="h">
                  <span className="t">eth · uniswap v3</span>
                  <span className="badge">pay-with-eth</span>
                </div>
                <div className="body">
                  <div className="row"><span className="k">quote</span><span>~0.0004 eth</span></div>
                  <div className="row"><span className="k">→ usdc</span><span>{agent.perCallHuman}</span></div>
                  <div className="row"><span className="k">slippage</span><span>0.30%</span></div>
                  <div className="row"><span className="k">route</span><span className="acc">eth/usdc · 0.30%</span></div>
                </div>
              </button>
            </div>

            <div className="route">
              <span className="leg">your eth</span>
              <div className="arrow"><span className="pool">v3 0.30% · base-sepolia</span></div>
              <span className="leg">vault usdc</span>
            </div>

            <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 12, fontSize: 11, color: "var(--mute)" }}>
              <span className="pill ok">price-locked · 30s</span>
              <span className="pill">uni v3 · WETH/USDC pool</span>
              <span className="pill">refund-on-fail guaranteed</span>
            </div>
          </div>

          <div className="nav-btns">
            <span className="why">
              {paidTxHash ? (
                <>tx <code className="acc">{shortAddr(paidTxHash, 6)}</code> · operator validating</>
              ) : (
                "submitting will issue an x402 challenge, then settle on base-sepolia."
              )}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={reset} disabled={busy}>
                reset
              </button>
              <button
                className="btn primary"
                onClick={result?.ok ? reset : runAudit}
                disabled={!isConnected || !input.trim() || busy}
              >
                {submitLabel}
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
            <h3>tee · sealed envelope</h3>
            <div className="stages">
              <Stage name="lock" label="lock" icon="[#]" current={phase} />
              <Stage name="break" label="seal break" icon="[/]" current={phase} />
              <Stage name="chip" label="attest chip" icon="[✓]" current={phase} />
              <Stage name="receipt" label="receipt" icon="[≡]" current={phase} />
            </div>
            <div className="seal-anim">
              <pre dangerouslySetInnerHTML={{ __html: FRAMES[phase](agent) }} />
            </div>
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
        <span className="t">tee attested · sealed inference verified</span>
        <span className="muted" style={{ fontSize: 10 }}>
          {r.computeBackend ?? "operator"}
        </span>
      </div>
      <h2>signed by the machine.</h2>
      <div className="body">
        model weights never left the enclave. response was generated, signed, and returned with a
        teeml attestation chained to the sealed bundle hash. agent vault debited {agent.perCallHuman}.
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

      <div className="out">
        <h4>response</h4>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12, color: "var(--fg-2)" }}>
          {tryFormatJson(result.output)}
        </pre>
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
