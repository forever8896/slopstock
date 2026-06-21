"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  usePublicClient,
  useReadContract,
  useSwitchChain,
  useWalletClient,
} from "wagmi";
import { base } from "wagmi/chains";
import { erc20Abi } from "@stratum/contracts-types";
import { x402Client } from "@x402/core/client";
import { ExactEvmScheme } from "@x402/evm";
import { wrapFetchWithPayment } from "@x402/fetch";
import type { AgentDetail } from "@/lib/agents";
import { inferPaid, type InferResult } from "@/lib/operator";
import { sampleContracts } from "@/lib/sample-contracts";
import { formatUsdc, shortAddr } from "@/lib/format";
import { InferenceOutput } from "@/components/inference-output";
import { Crumb } from "@/components/crumb";
import { Rail } from "@/components/rail";

interface Props {
  agent: AgentDetail;
}

type Hex = `0x${string}`;
type Phase = "lock" | "break" | "chip" | "receipt";

const BASE_CHAIN_ID = base.id; // Base mainnet (8453)
/** Canonical Circle USDC on Base mainnet (the x402 settlement asset). */
const USDC_BASE: Hex = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

export function SubscribeClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const { data: walletClient } = useWalletClient({ chainId: BASE_CHAIN_ID });
  const publicClient = usePublicClient({ chainId: BASE_CHAIN_ID });
  const onBase = chainId === BASE_CHAIN_ID;

  const [input, setInput] = useState(
    "Best risk-adjusted USDC yield right now — moderate risk, any chain. Check recent protocol risk.",
  );
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
    address: USDC_BASE,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const price = agent.perCallUsdc;
  const hasUsdc = usdcBalance !== undefined && usdcBalance >= price;

  // Live tick during the poll phase so the UI doesn't look frozen.
  useEffect(() => {
    if (!pollStartedAt) {
      setElapsed(0);
      return;
    }
    const id = setInterval(() => setElapsed(Math.floor((Date.now() - pollStartedAt) / 1000)), 500);
    return () => clearInterval(id);
  }, [pollStartedAt]);

  async function runAgent() {
    if (!input.trim() || !address) return;
    setErrorMsg(null);

    if (!onBase) {
      setErrorMsg(`switch your wallet to Base (chain ${BASE_CHAIN_ID})`);
      return;
    }
    if (!hasUsdc) {
      setErrorMsg(
        `insufficient USDC (have ${usdcBalance ? formatUsdc(usdcBalance, 2) : "0"}, need ${formatUsdc(price, 2)} on Base mainnet).`,
      );
      return;
    }
    if (!walletClient || !publicClient) {
      setErrorMsg("wallet not ready — reconnect and try again");
      return;
    }

    setBusy(true);
    setStep(2);
    setPhase("lock");

    try {
      // x402 v2 client — the wallet signs an EIP-3009 authorization on the 402
      // challenge (GASLESS: no ETH needed). The operator verifies + settles via
      // the facilitator, then the agent runs and the answer is polled back.
      // ClientEvmSigner needs `.address` directly (a viem WalletClient only has
      // `.account.address`), so build the signer explicitly: wallet signs, a
      // public client does the optional reads.
      const signer = {
        address: walletClient.account.address,
        signTypedData: (m: Record<string, unknown>) =>
          walletClient.signTypedData({ ...(m as Parameters<typeof walletClient.signTypedData>[0]), account: walletClient.account }),
        readContract: (a: Parameters<NonNullable<typeof publicClient>["readContract"]>[0]) => publicClient!.readContract(a),
      } as unknown as ConstructorParameters<typeof ExactEvmScheme>[0];
      const client = new x402Client().register("eip155:8453", new ExactEvmScheme(signer));
      // Bind fetch to the window so the x402 wrapper can't trip "Illegal
      // invocation"/"Failed to fetch" when it calls the base fetch unbound.
      const boundFetch = (input: RequestInfo | URL, init?: RequestInit) => window.fetch(input, init);
      const payFetch = wrapFetchWithPayment(boundFetch as unknown as typeof fetch, client);

      setPhase("break");
      setStep(3);
      setPollStartedAt(Date.now());
      setTimeout(() => setPhase("chip"), 1200);

      const { result: r, settlementTx } = await inferPaid(payFetch, {
        tokenId: agent.tokenId.toString(),
        input,
        subscriber,
      });
      if (settlementTx) setPaidTxHash(settlementTx as Hex);

      if (!r.ok) {
        const msg = r.kind === "payment-required" ? "payment was rejected — check your USDC balance" : r.message;
        setErrorMsg(`agent did not return: ${msg}`);
        setStep(2);
        setPhase("lock");
        return;
      }
      setResult(r);
      setPhase("receipt");
      setStep(4);
      void refetchUsdc();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErrorMsg(/rejected|denied|User rejected/i.test(msg) ? "you rejected the signature" : msg);
      setStep(2);
      setPhase("lock");
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
    if (busy && pollStartedAt) return "running inference…";
    if (busy) return "sign in your wallet…";
    if (result?.ok) return "verified ✓ · run another";
    return `submit · pay ${agent.perCallHuman} →`;
  }, [busy, pollStartedAt, result, agent.perCallHuman]);

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
            x402 endpoint <span className="fg2">/x402/infer · {agent.perCallHuman}</span> · Base mainnet
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
          <span style={{ color: "var(--amber)" }}>switch to Base mainnet (chain {BASE_CHAIN_ID}) to pay</span>
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
              Plain text. The agent reads this the same way every other agent on this site does —
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
              02 · how you&apos;ll pay <span className="muted" style={{ float: "right" }}>x402 · gasless</span>
            </h3>
            <div className="muted" style={{ marginBottom: 10, fontSize: 14 }}>
              The operator returns a <code>402 Payment Required</code> over the x402 standard. Your
              wallet <b>signs</b> an EIP-3009 USDC authorization for{" "}
              <span className="acc">{agent.perCallHuman} USDC</span> — no gas, no ETH needed. A
              facilitator settles it on Base mainnet straight into{" "}
              <b>{agent.ticker}&apos;s own working wallet</b>, which is the same wallet the agent
              spends from when it pays other x402 services. Earn → budget → spend, all on mainnet.
            </div>
            <div className="pay-grid">
              <div className="pay-card on">
                <div className="h">
                  <span className="t">sign USDC authorization</span>
                  <span className="badge">gasless</span>
                </div>
                <div className="body">
                  <div className="row"><span className="k">price</span><span>{agent.perCallHuman} USDC</span></div>
                  <div className="row"><span className="k">your balance</span><span>{usdcBalance !== undefined ? `$${formatUsdc(usdcBalance, 2)}` : "—"}</span></div>
                  <div className="row"><span className="k">network</span><span>Base mainnet · eip155:8453</span></div>
                  <div className="row"><span className="k">gas</span><span>none — facilitator settles</span></div>
                </div>
              </div>
            </div>

            <div className="route">
              <span className="leg">your wallet</span>
              <div className="arrow"><span className="pool">x402 · EIP-3009 sig → facilitator</span></div>
              <span className="leg">{agent.ticker} wallet</span>
            </div>
          </div>

          <div style={{ marginTop: 14 }}>
            <button
              className={"mint-btn" + (busy ? " busy" : "")}
              onClick={result?.ok ? reset : runAgent}
              disabled={!isConnected || !input.trim() || busy}
            >
              {submitLabel}
              {!busy ? <span className="ar">→</span> : null}
            </button>
            <div style={{ display: "flex", justifyContent: "space-between", marginTop: 10, fontSize: 13, color: "var(--mute)" }}>
              <span>
                {paidTxHash ? (
                  <>settled in tx <code className="acc">{shortAddr(paidTxHash, 6)}</code> on Base mainnet — agent is running…</>
                ) : (
                  "click submit → wallet asks for one signature (gasless) → agent runs in TEE → response below"
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
              <Stage name="lock" label="sign x402 payment" icon="[#]" current={phase} />
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
        forged. The {agent.perCallHuman} you paid landed in {agent.ticker}&apos;s own wallet on Base
        mainnet — the budget it spends from when it pays other agents and services over x402.
      </div>

      <div className="grid">
        <div className="c">
          <div className="l">settlement tx</div>
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
          <div className="v acc">settled · Base mainnet</div>
        </div>
      </div>

      {result.steps && result.steps.length > 0 ? (
        <div className="exec-flow" style={{ marginTop: 18 }}>
          <h4 style={{ margin: "0 0 10px" }}>execution flow</h4>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <FlowStep icon="▸" label="x402 paid" detail={`you → ${agent.ticker} · ${agent.perCallHuman} on Base mainnet`} accent />
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

const FRAMES: Record<Phase, (a: AgentDetail) => string> = {
  lock: (a) =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] sign x402 authorization…</span>        │
  │   pay      · ${a.perCallHuman.padEnd(7)}                │
  │   model    · ${a.runtime.padEnd(20)}   │
  │                                     │
  │ <span class="mu">[ ] ship to enclave</span>                  │
  │ <span class="mu">[ ] attestation chip</span>                 │
  │ <span class="mu">[ ] signed receipt</span>                   │
  └─────────────────────────────────────┘`,
  break: () =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] payment settled on Base ✓</span>       │
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
  │ <span class="acc">[#] payment settled ✓</span>               │
  │ <span class="acc">[/] enclave returned response ✓</span>     │
  │   response · signed                 │
  │                                     │
  │ <span class="acc">[✓] attestation chip generated</span>      │
  │   signer   · teeml                  │
  │                                     │
  │ <span class="am">[≡] returning receipt…</span>               │
  └─────────────────────────────────────┘`,
  receipt: (a) =>
    `  ┌─────────────────────────────────────┐
  │ <span class="acc">[#] payment settled ✓</span>               │
  │ <span class="acc">[/] enclave returned response ✓</span>     │
  │ <span class="acc">[✓] attestation chip ✓</span>              │
  │ <span class="acc">[≡] receipt returned ✓</span>              │
  │                                     │
  │   total  · ${a.perCallHuman.padEnd(7)} settled         │
  │   model  · ${a.runtime.padEnd(24)}     │
  │   chain  · base mainnet             │
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
