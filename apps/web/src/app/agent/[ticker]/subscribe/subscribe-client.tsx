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
import { AttestationBadge } from "@/components/attestation-badge";
import { AuditOutput } from "@/components/audit-output";
import { TranscriptView } from "@/components/transcript-view";
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
  | { kind: "tx-submitted"; hash: Hex; payment: "USDC" | "ETH" }
  | { kind: "infer" }
  | { kind: "done"; result: InferResult };

type PayToken = "USDC" | "ETH";

const BASE_CHAIN_ID = baseSepolia.id;

/** Generous max-ETH per call. With pool at ~1 WETH = 2500 USDC, 1 USDC out
 *  costs ~0.0004 ETH. We send 0.001 ETH and refund excess via the multicall. */
const ETH_AMOUNT_IN_MAX = parseEther("0.001");

export function SubscribeClient({ agent }: Props) {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onBase = chainId === BASE_CHAIN_ID;

  const [input, setInput] = useState("");
  const [payToken, setPayToken] = useState<PayToken>("USDC");
  const [stage, setStage] = useState<FlowStage>({ kind: "idle" });
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const subscriber: Hex = address ?? "0x0000000000000000000000000000000000000000";

  // ─── Balances ─────────────────────────────────────────────────────
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

  // ─── Tx ───────────────────────────────────────────────────────────
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
    setStage({ kind: "preflight" });

    if (!onBase) {
      setErrorMsg(`switch your wallet to Base Sepolia (chain ${BASE_CHAIN_ID})`);
      setStage({ kind: "idle" });
      return;
    }

    if (payToken === "USDC" && !hasUsdc) {
      setErrorMsg(
        `insufficient USDC (have ${usdcBalance ? formatUsdc(usdcBalance, 2) : "0"}, need ${formatUsdc(price, 2)}). Or pay in ETH instead.`,
      );
      setStage({ kind: "idle" });
      return;
    }
    if (payToken === "ETH" && !hasEth) {
      setErrorMsg(
        `need at least ${parseEther("0.001")} wei of ETH on Base Sepolia. Faucet: bridge.base.org/deposit (testnet)`,
      );
      setStage({ kind: "idle" });
      return;
    }

    try {
      setStage({ kind: "awaiting-tx" });

      let hash: Hex;
      if (payToken === "USDC") {
        // Direct USDC.transfer to vault.
        hash = await writeContractAsync({
          address: USDC_BASE_SEPOLIA,
          abi: erc20Abi,
          functionName: "transfer",
          args: [agent.contracts.vault, price],
          chainId: BASE_CHAIN_ID,
        });
      } else {
        // Swap ETH→USDC via Uniswap V3 SwapRouter02, output goes directly to
        // the vault. One tx: payable multicall wraps ETH, swaps, refunds dust.
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

      setStage({ kind: "tx-submitted", hash, payment: payToken });
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
      void refetchUsdc();
      void refetchEth();
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
      setStage({ kind: "idle" });
    }
  }

  const buttonLabel = useMemo(() => {
    switch (stage.kind) {
      case "idle":
        return payToken === "USDC"
          ? `pay ${agent.perCallHuman} & run audit`
          : `pay ~0.0004 ETH & run audit`;
      case "preflight":
      case "awaiting-tx":
        return "approve in wallet…";
      case "tx-submitted":
        return txPending
          ? stage.payment === "ETH"
            ? "swapping ETH→USDC + sending to vault…"
            : "waiting for confirmation…"
          : "submitting to operator…";
      case "infer":
        return "running inference…";
      case "done":
        return "run another audit";
    }
  }, [stage, txPending, payToken, agent.perCallHuman]);

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
          <span>switch to Base Sepolia (chain {BASE_CHAIN_ID}) to pay</span>
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
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-text-muted">pay with</span>
          {(["USDC", "ETH"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setPayToken(t)}
              className={`border px-3 py-1 text-xs ${
                payToken === t
                  ? "border-accent-green text-accent-green"
                  : "border-border text-text-muted hover:text-text-primary"
              }`}
            >
              {t}
            </button>
          ))}
          <span className="ml-2 text-text-muted">
            → {agent.perCallHuman} USDC at vault {agent.contracts.vault.slice(0, 10)}…
          </span>
        </div>
        <div className="text-xs text-text-muted">
          {payToken === "USDC" ? (
            <>
              direct <code>USDC.transfer</code> to vault.{" "}
              {address && onBase ? (
                <>your USDC: {usdcBalance !== undefined ? formatUsdc(usdcBalance, 2) : "—"}</>
              ) : null}
            </>
          ) : (
            <>
              ETH → swapped via{" "}
              <a
                href="https://docs.uniswap.org/contracts/v3/reference/deployments/base-deployments"
                target="_blank"
                rel="noreferrer"
                className="text-accent-green hover:underline"
              >
                Uniswap V3 SwapRouter02
              </a>{" "}
              against the WETH/USDC pool, output sent directly to vault. Up to 0.001 ETH spent;
              dust refunded.{" "}
              {address && onBase ? (
                <>your ETH: {ethBalance ? Number(ethBalance.value) / 1e18 : "—"}</>
              ) : null}
            </>
          )}
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
          {(stage as { payment?: PayToken }).payment === "ETH" ? (
            <span className="ml-2 text-text-muted">— Uniswap V3 swap+settle</span>
          ) : null}
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
      <TranscriptView receipt={result.receipt} />
      <details className="panel p-4 text-xs">
        <summary className="label cursor-pointer">raw receipt (callId {result.callId})</summary>
        <pre className="mt-3 overflow-auto whitespace-pre-wrap text-text-muted">
          {JSON.stringify(result.receipt, null, 2)}
        </pre>
      </details>
    </div>
  );
}
