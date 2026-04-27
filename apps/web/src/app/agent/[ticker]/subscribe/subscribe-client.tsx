"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { erc20Abi } from "@stratum/contracts-types";
import { USDC_BASE_SEPOLIA } from "@stratum/shared";
import { AttestationBadge } from "@/components/attestation-badge";
import { AuditOutput } from "@/components/audit-output";
import type { AgentDetail } from "@/lib/agents";
import { infer, type InferResult, type PaymentReceipt } from "@/lib/operator";
import { sampleContracts } from "@/lib/sample-contracts";
import { formatUsdc } from "@/lib/format";

interface Props {
  agent: AgentDetail;
}

type Hex = `0x${string}`;

type FlowStage =
  | { kind: "idle" }
  | { kind: "preflight" }
  | { kind: "awaiting-tx" }
  | { kind: "tx-submitted"; hash: Hex }
  | { kind: "infer" }
  | { kind: "done"; result: InferResult };

const BASE_CHAIN_ID = baseSepolia.id;

export function SubscribeClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onBase = chainId === BASE_CHAIN_ID;

  const [input, setInput] = useState("");
  const [stage, setStage] = useState<FlowStage>({ kind: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const subscriber: Hex = address ?? "0x0000000000000000000000000000000000000000";

  // Live USDC balance on Base Sepolia.
  const { data: usdcBalance, refetch: refetchBalance } = useReadContract({
    address: USDC_BASE_SEPOLIA,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: BASE_CHAIN_ID,
    query: { enabled: Boolean(address) },
  });

  const price = agent.perCallUsdc;
  const hasFunds = usdcBalance !== undefined && usdcBalance >= price;

  // ─── Payment ──────────────────────────────────────────────────────
  const { writeContractAsync, data: txHash } = useWriteContract();
  const { isLoading: txPending, isSuccess: txConfirmed } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: BASE_CHAIN_ID,
  });

  // Once the payment tx confirms, submit to operator.
  useEffect(() => {
    if (!txConfirmed || !txHash) return;
    void submitToOperator(txHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [txConfirmed, txHash]);

  async function runAudit() {
    if (!input.trim() || !address) return;
    setErrorMsg(null);
    setStage({ kind: "preflight" });

    if (!onBase) {
      setErrorMsg(`switch your wallet to Base Sepolia (chain ${BASE_CHAIN_ID})`);
      setStage({ kind: "idle" });
      return;
    }

    if (!hasFunds) {
      setErrorMsg(
        `insufficient USDC (have ${usdcBalance ? formatUsdc(usdcBalance, 2) : "0"}, need ${formatUsdc(price, 2)}). Get testnet USDC at faucet.circle.com`,
      );
      setStage({ kind: "idle" });
      return;
    }

    try {
      setStage({ kind: "awaiting-tx" });
      const hash = await writeContractAsync({
        address: USDC_BASE_SEPOLIA,
        abi: erc20Abi,
        functionName: "transfer",
        args: [agent.contracts.vault, price],
        chainId: BASE_CHAIN_ID,
      });
      setStage({ kind: "tx-submitted", hash });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage({ kind: "idle" });
    }
  }

  async function submitToOperator(hash: Hex) {
    setStage({ kind: "infer" });
    setErrorMsg(null);
    const receipt: PaymentReceipt = {
      txHash: hash,
      facilitator: "chain",
      receiptId: `rcpt-${crypto.randomUUID()}`,
    };
    try {
      const result = await infer({
        tokenId: agent.tokenId.toString(),
        input,
        subscriber,
        paymentReceipt: receipt,
      });
      setStage({ kind: "done", result });
      void refetchBalance();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage({ kind: "idle" });
    }
  }

  const buttonLabel = useMemo(() => {
    switch (stage.kind) {
      case "idle":
        return `pay ${agent.perCallHuman} & run audit`;
      case "preflight":
      case "awaiting-tx":
        return "approve in wallet…";
      case "tx-submitted":
        return txPending ? "waiting for confirmation…" : "submitting to operator…";
      case "infer":
        return "running inference…";
      case "done":
        return "run another audit";
    }
  }, [stage, txPending, agent.perCallHuman]);

  function reset() {
    setStage({ kind: "idle" });
    setErrorMsg(null);
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

      {!isConnected ? (
        <div className="panel border-yellow-400 px-4 py-3 text-sm">
          connect a wallet to pay
        </div>
      ) : !onBase ? (
        <div className="panel border-yellow-400 px-4 py-3 text-sm flex items-center justify-between">
          <span>switch to Base Sepolia (chain {BASE_CHAIN_ID}) to pay USDC</span>
          <button
            onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}
            className="border border-accent-green px-3 py-1.5 text-xs text-accent-green hover:bg-bg-elev"
          >
            switch network
          </button>
        </div>
      ) : null}

      <section className="panel p-4">
        <div className="label mb-3">payment</div>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <span className="text-text-muted">pay with</span>
            <span className="border border-accent-green px-2 py-1 text-xs text-accent-green">USDC</span>
            <span className="ml-2 text-text-muted">→ {agent.perCallHuman} → vault {agent.contracts.vault.slice(0, 10)}…</span>
          </div>
          {address && onBase ? (
            <span className="text-xs text-text-muted">
              your USDC: {usdcBalance !== undefined ? formatUsdc(usdcBalance, 2) : "—"}
            </span>
          ) : null}
        </div>
        {address && onBase && !hasFunds ? (
          <div className="mt-3 text-xs text-text-muted">
            need testnet USDC?{" "}
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noreferrer"
              className="text-accent-green hover:underline"
            >
              faucet.circle.com
            </a>
            {" "}— mint some to your address ({address.slice(0, 8)}…)
          </div>
        ) : null}
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
            subscriber:&nbsp;<code className="text-text-primary">{address ?? "(no wallet)"}</code>
          </div>
          <button
            type="button"
            onClick={stage.kind === "done" ? reset : runAudit}
            disabled={!isConnected || !input.trim() || (stage.kind !== "idle" && stage.kind !== "done")}
            className="border border-accent-green px-4 py-2 text-sm text-accent-green hover:bg-bg-elev disabled:cursor-not-allowed disabled:opacity-50"
          >
            {buttonLabel}
          </button>
        </div>
      </section>

      {errorMsg ? (
        <div className="border border-accent-red bg-bg-elev px-4 py-3 text-sm text-accent-red">
          {errorMsg}
        </div>
      ) : null}

      {stage.kind === "tx-submitted" || stage.kind === "infer" ? (
        <div className="panel border-blue-400 px-4 py-3 text-xs">
          payment tx:{" "}
          <code className="text-text-primary">
            {(stage as { hash?: Hex }).hash ?? "—"}
          </code>
          {stage.kind === "infer" ? <span className="ml-2">— operator validating + running inference…</span> : null}
        </div>
      ) : null}

      {stage.kind === "done" ? (
        <ResultPanel result={stage.result} expectedMeasurement={agent.expectedTeeMeasurement} />
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
