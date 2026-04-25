"use client";

import Link from "next/link";
import { use, useState } from "react";
import { AcquireEventLog } from "@/components/acquire-event-log";
import { MockBanner } from "@/components/mock-banner";
import {
  buildAcceptSequence,
  defaultDemoBid,
  type BidState,
  type EventLogEntry,
} from "@/lib/acquire";
import { formatUsdc, relativeTime, shortAddr } from "@/lib/format";
import { findMockAgent } from "@/lib/mock";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

const ACTIVE_SUBSCRIBERS = 4; // mocked; in real flow we read from authorizeUsage[]

export default function AcquirePage({ params }: PageProps) {
  const { ticker } = use(params);
  const agent = findMockAgent(ticker.toUpperCase());

  // Demo state. In the real wagmi-wired version: useReadContract(Marketplace.getBid),
  // useWriteContract for postBid + accept, and event watchers for the log.
  const [bid, setBid] = useState<BidState>(() => defaultDemoBid());
  const [events, setEvents] = useState<EventLogEntry[]>([]);
  const [acquired, setAcquired] = useState(false);
  const [accepting, setAccepting] = useState(false);

  // Bidder form state
  const [formPrice, setFormPrice] = useState("60000");
  const [formExpiryHours, setFormExpiryHours] = useState("48");

  if (!agent) {
    return (
      <div className="panel p-6 text-sm">
        agent not found.{" "}
        <Link href="/" className="text-accent-green hover:underline">
          back to markets
        </Link>
      </div>
    );
  }

  const sellerAddress = "0x0FF1CE0000000000000000000000000000000001" as const;
  const ownerLabel = acquired ? bid.bidder : sellerAddress;

  function postBid() {
    const priceUsdc = BigInt(Math.floor(Number(formPrice) * 1_000_000));
    if (priceUsdc <= bid.price) {
      setEvents((e) => [
        ...e,
        {
          ts: Date.now(),
          kind: "info",
          title: "Bid rejected",
          lines: [`new price (${formPrice} USDC) must strictly beat current best`],
        },
      ]);
      return;
    }
    const fresh: BidState = {
      bidder: "0xACC0017E000000000000000000000000ACC01242",
      price: priceUsdc,
      pubkey: "0x04abcd0123456789defabcdef1234567890abcdef1234567890abcdef12345678",
      expiresAt: Math.floor(Date.now() / 1000) + Number(formExpiryHours) * 3_600,
    };
    setBid(fresh);
    setEvents((e) => [
      ...e,
      {
        ts: Date.now(),
        kind: "post",
        title: "Marketplace.postBid",
        lines: [
          `tokenId=${agent!.tokenId.toString()} price=${formPrice} USDC`,
          `escrow locked from ${fresh.bidder.slice(0, 10)}…`,
          `expires ${new Date(fresh.expiresAt * 1_000).toISOString().slice(0, 19)}Z`,
        ],
      },
    ]);
  }

  async function acceptBid() {
    if (acquired || accepting) return;
    setAccepting(true);

    const sequence = buildAcceptSequence({
      bid,
      seller: sellerAddress,
      ensName: agent!.ens,
      activeSubscribers: ACTIVE_SUBSCRIBERS,
    });

    // Append events with realistic offsets so the log feels like a live wire trace.
    const start = Date.now();
    for (const ev of sequence) {
      const delay = Math.max(0, ev.ts - start);
      await new Promise((r) => setTimeout(r, delay));
      setEvents((e) => [...e, { ...ev, ts: Date.now() }]);
    }

    setAcquired(true);
    setAccepting(false);
  }

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

      <MockBanner note="The Marketplace + StratumAgentNFT contracts aren't deployed to a live network yet. The flow below uses real ABIs and real event semantics; on-chain reads/writes activate once we deploy." />

      <section className="panel p-4">
        <div className="label mb-3">current owner</div>
        <div className="flex items-center justify-between text-sm">
          <code className="text-text-primary">{ownerLabel}</code>
          <span className="text-xs text-text-muted">
            {acquired ? "acquired just now" : "since mint"}
          </span>
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2">
        <section className="panel p-4">
          <div className="label mb-3">post bid</div>
          <p className="mb-3 text-xs text-text-muted">
            Strictly beat the current best ({formatUsdc(bid.price, 0)} USDC). Escrow is pulled
            up-front; the prior bidder is refunded by the contract.
          </p>
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
            disabled={acquired}
            className="mt-4 w-full border border-border px-3 py-2 text-sm hover:border-accent-green hover:text-accent-green disabled:cursor-not-allowed disabled:opacity-40"
          >
            post bid
          </button>
        </section>

        <section className="panel p-4">
          <div className="label mb-3">current best bid</div>
          <dl className="space-y-2 text-sm">
            <Row label="price" value={`${formatUsdc(bid.price, 0)} USDC`} />
            <Row label="bidder" value={shortAddr(bid.bidder, 6)} />
            <Row label="expires" value={relativeTime(bid.expiresAt)} />
            <Row label="bidder pubkey" value={shortAddr(bid.pubkey, 6)} hint="will receive the sealed content key" />
          </dl>
          <button
            type="button"
            onClick={acceptBid}
            disabled={acquired || accepting}
            className="mt-4 w-full border border-accent-red bg-bg-elev px-3 py-2 text-sm text-accent-red hover:bg-bg-base disabled:cursor-not-allowed disabled:opacity-40"
          >
            {acquired ? "acquired ✓" : accepting ? "accepting…" : `accept (TEE re-encrypt + iTransfer)`}
          </button>
          <details className="mt-3 text-xs">
            <summary className="cursor-pointer text-text-muted">what this will do</summary>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-text-muted">
              <li>generate a fresh content key inside Intel TDX</li>
              <li>re-encrypt the weights, system prompt, and RAG corpus</li>
              <li>seal the new key under the bidder&apos;s pubkey</li>
              <li>call AgentNFT.iTransfer (verifies the proof onchain)</li>
              <li>atomically clear all {ACTIVE_SUBSCRIBERS} active subscriber grants</li>
              <li>flip the ENS resolver to the acquirer</li>
            </ol>
          </details>
        </section>
      </div>

      <AcquireEventLog events={events} />
    </div>
  );
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
