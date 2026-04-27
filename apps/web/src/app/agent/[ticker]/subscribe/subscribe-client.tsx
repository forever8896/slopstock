"use client";

import Link from "next/link";
import { useState } from "react";
import { useAccount } from "wagmi";
import { AttestationBadge } from "@/components/attestation-badge";
import { AuditOutput } from "@/components/audit-output";
import type { AgentDetail } from "@/lib/agents";
import { buildDemoReceipt, infer, type InferResult } from "@/lib/operator";
import { sampleContracts } from "@/lib/sample-contracts";

interface Props {
  agent: AgentDetail;
}

export function SubscribeClient({ agent }: Props) {
  const { address } = useAccount();
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InferResult | undefined>();

  // Honest sentinel when no wallet is connected. The operator's payment-receipt
  // validation doesn't currently bind subscriber to receipt — that's Phase 3.
  const subscriber = (address ??
    "0x1111111111111111111111111111111111111111") as `0x${string}`;

  async function runAudit() {
    if (!input.trim()) return;
    setRunning(true);
    setResult(undefined);
    try {
      // 1. Surface the 402 challenge so the user sees the real x402 contract.
      const challenge = await infer({
        tokenId: agent.tokenId.toString(),
        input,
        subscriber,
      });
      if (challenge.ok || challenge.kind === "error") {
        setResult(challenge);
        return;
      }

      // 2. Build a payment receipt for the operator's x402 layer. Today the
      //    operator runs in DEMO_MODE and accepts a non-empty receipt; once
      //    Phase 3 lands, this swaps for a real Uniswap swap + on-chain settle.
      const receipt = buildDemoReceipt();

      // 3. Re-submit with the receipt header.
      const final = await infer({
        tokenId: agent.tokenId.toString(),
        input,
        subscriber,
        paymentReceipt: receipt,
      });
      setResult(final);
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <div className="text-xs text-text-muted">
          <Link href={`/agent/${agent.ticker}`} className="hover:text-text-primary">
            ← {agent.ens}
          </Link>
        </div>
        <h1 className="text-2xl">subscribe & infer</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Pay {agent.perCallHuman} per call. Inference runs inside 0G Compute&apos;s Sealed
          Executor; output is signed and bound to a TEE measurement that this UI verifies before
          rendering.
        </p>
      </header>

      <section className="panel p-4">
        <div className="label mb-3">payment</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">pay with</span>
          <span className="border border-accent-green px-2 py-1 text-xs text-accent-green">USDC</span>
          <span className="ml-2 text-text-muted">→ {agent.perCallHuman} USDC.base</span>
        </div>
      </section>

      <section className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="label">solidity input</div>
          <div className="flex gap-2 text-xs">
            {sampleContracts.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => setInput(s.source)}
                className="border border-border px-2 py-1 text-text-muted hover:border-accent-green hover:text-accent-green"
                title={s.bug}
              >
                {s.label}
              </button>
            ))}
          </div>
        </div>
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="paste solidity, or click a preset above"
          spellCheck={false}
          className="h-64 w-full resize-y border border-border bg-bg-base p-3 font-mono text-xs outline-none focus:border-accent-green"
        />
        <div className="mt-3 flex items-center justify-between">
          <div className="text-xs text-text-muted">
            subscriber:&nbsp;<code className="text-text-primary">{subscriber}</code>
          </div>
          <button
            type="button"
            onClick={runAudit}
            disabled={running || !input.trim()}
            className="border border-accent-green px-4 py-2 text-sm text-accent-green hover:bg-bg-elev disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "running…" : `pay ${agent.perCallHuman} & run audit`}
          </button>
        </div>
      </section>

      {result ? (
        <ResultPanel result={result} expectedMeasurement={agent.expectedTeeMeasurement} />
      ) : null}
    </div>
  );
}

function ResultPanel({
  result,
  expectedMeasurement,
}: {
  result: InferResult;
  expectedMeasurement: `0x${string}`;
}) {
  if (!result.ok) {
    if (result.kind === "payment-required") {
      return (
        <div className="border border-yellow-400 bg-bg-elev px-4 py-3 text-sm">
          402 Payment Required — challenge: {result.challenge.amount} {result.challenge.asset} →{" "}
          <code className="text-text-primary">{result.challenge.recipient}</code>
        </div>
      );
    }
    return (
      <div className="border border-accent-red bg-bg-elev px-4 py-3 text-sm text-accent-red">
        error ({result.status}): {result.message}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <AttestationBadge receipt={result.receipt} expectedMeasurement={expectedMeasurement} />
      <AuditOutput raw={result.output} />
      <details className="panel p-4 text-xs">
        <summary className="label cursor-pointer">raw receipt (callId {result.callId})</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap text-text-muted">
          {JSON.stringify(result.receipt, null, 2)}
        </pre>
      </details>
    </div>
  );
}
