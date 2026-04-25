"use client";

import Link from "next/link";
import { use, useState } from "react";
import { useAccount } from "wagmi";
import { AttestationBadge } from "@/components/attestation-badge";
import { AuditOutput } from "@/components/audit-output";
import { findMockAgent } from "@/lib/mock";
import { buildDemoReceipt, infer, type InferResult } from "@/lib/operator";
import { sampleContracts } from "@/lib/sample-contracts";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

const TOKEN_OPTIONS = ["USDC", "PEPE", "DAI", "ETH"] as const;
type Token = (typeof TOKEN_OPTIONS)[number];

export default function SubscribePage({ params }: PageProps) {
  const { ticker } = use(params);
  const agent = findMockAgent(ticker.toUpperCase());

  const { address } = useAccount();
  const [token, setToken] = useState<Token>("USDC");
  const [input, setInput] = useState("");
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<InferResult | undefined>();

  if (!agent) {
    return (
      <div className="panel p-6 text-sm">
        agent not found. <Link href="/" className="text-accent-green hover:underline">back to markets</Link>
      </div>
    );
  }

  // Simulated subscriber address — wagmi's connected account if available, else
  // a demo zero-suffix sentinel. Demo mode in operator doesn't validate this.
  const subscriber = (address ?? "0x1111111111111111111111111111111111111111") as `0x${string}`;

  async function runAudit() {
    if (!input.trim() || !agent) return;
    setRunning(true);
    setResult(undefined);
    try {
      // 1. First call without payment to surface the 402 challenge in the UI
      // (this round-trip would happen automatically in a real wallet flow).
      const challenge = await infer({ tokenId: agent.tokenId.toString(), input, subscriber });
      if (challenge.ok || challenge.kind === "error") {
        setResult(challenge);
        return;
      }

      // 2. Build a demo receipt (stand-in for Uniswap pay-with-any-token).
      const receipt = buildDemoReceipt();

      // 3. Resubmit with payment header.
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
          <Link href={`/agent/${agent.ticker}`} className="hover:text-text-primary">← {agent.ens}</Link>
        </div>
        <h1 className="text-2xl">subscribe & infer</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          Pay {agent.pricing.perCallHuman} per call. Inference runs inside 0G Compute&apos;s Sealed
          Executor; output is signed and bound to a TEE measurement that this UI verifies before
          rendering. {token === "USDC" ? null : (
            <span className="text-accent-green">[mock]</span>
          )} {" "}
          {token !== "USDC" ? (
            <span>
              The {token} → USDC swap is simulated for now — live Uniswap{" "}
              <code className="text-text-primary">pay-with-any-token</code> wires up next.
            </span>
          ) : null}
        </p>
      </header>

      <section className="panel p-4">
        <div className="label mb-3">payment</div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">pay with</span>
          {TOKEN_OPTIONS.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setToken(t)}
              className={`border px-2 py-1 text-xs ${
                token === t
                  ? "border-accent-green text-accent-green"
                  : "border-border text-text-muted hover:text-text-primary"
              }`}
            >
              {t}
            </button>
          ))}
          <span className="ml-2 text-text-muted">→ {agent.pricing.perCallHuman} USDC.base</span>
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
            subscriber:&nbsp;
            <code className="text-text-primary">{subscriber}</code>
          </div>
          <button
            type="button"
            onClick={runAudit}
            disabled={running || !input.trim()}
            className="border border-accent-green px-4 py-2 text-sm text-accent-green hover:bg-bg-elev disabled:cursor-not-allowed disabled:opacity-50"
          >
            {running ? "running…" : `pay ${agent.pricing.perCallHuman} & run audit`}
          </button>
        </div>
      </section>

      {result ? <ResultPanel result={result} expectedMeasurement={agent.expectedTeeMeasurement} /> : null}
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
