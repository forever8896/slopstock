"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAccount, useSignMessage } from "wagmi";
import type { Hex } from "viem";

const OPERATOR_URL =
  process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

interface Props {
  tokenId: bigint;
  ticker: string;
  creator: Hex;
}

/**
 * Creator-only delete trigger.
 *
 * Hidden when the connected wallet is not the agent's creator. On click,
 * shows native confirm() before requesting a personal_sign over
 *   `delete agent <tokenId> at <ms-since-epoch>`
 * and POSTing {signer, signedAt, signature} to the operator.
 */
export function DeleteAgentButton({ tokenId, ticker, creator }: Props) {
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const isCreator =
    isConnected &&
    address &&
    address.toLowerCase() === creator.toLowerCase();

  if (!isCreator) return null;

  async function onDelete(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setErr(null);
    if (
      !window.confirm(
        `Delete ${ticker} from the listing?\n\nThis removes it from the operator's routing table only — the on-chain iNFT, vault, and shares stay intact. You'll be asked to sign a message to prove you're the creator.`,
      )
    ) {
      return;
    }
    setPending(true);
    try {
      const signedAt = Date.now();
      const message = `delete agent ${tokenId.toString()} at ${signedAt}`;
      const signature = await signMessageAsync({ message });
      const res = await fetch(`${OPERATOR_URL}/agents/${tokenId.toString()}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          signer: address,
          signedAt,
          signature,
        }),
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error ?? `HTTP ${res.status}`);
      }
      router.refresh();
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : String(e2));
    } finally {
      setPending(false);
    }
  }

  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <button
        type="button"
        onClick={onDelete}
        disabled={pending}
        title={`delete ${ticker} (creator-only)`}
        style={{
          background: "transparent",
          border: "1px solid rgba(239,68,68,0.4)",
          color: "var(--red, #ef4444)",
          fontSize: 10,
          padding: "2px 6px",
          borderRadius: 3,
          cursor: pending ? "wait" : "pointer",
          fontFamily: "inherit",
          opacity: pending ? 0.6 : 1,
        }}
      >
        {pending ? "…" : "✕"}
      </button>
      {err ? (
        <span
          title={err}
          style={{ color: "var(--red, #ef4444)", fontSize: 10 }}
        >
          err
        </span>
      ) : null}
    </span>
  );
}
