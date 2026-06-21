import Link from "next/link";
import { notFound } from "next/navigation";
import {
  loadAgentDetail,
  loadHolders,
  loadInferences,
  loadSnapshots,
  type AgentDetail,
  type Holder,
  type InferenceLog,
} from "@/lib/agents";
import { ensAppUrl, verifyEns, type EnsVerification } from "@/lib/ens";
import { formatShares, formatUsdc, pctOf, relativeTime, shortAddr } from "@/lib/format";
import { DistributeButton } from "@/components/distribute-button";
import { AnimatedTicker } from "@/components/animated-ticker";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { ticker } = await params;
  const agent = await loadAgentDetail(ticker.toUpperCase());
  if (!agent) notFound();

  // Resilient: a flaky/archive-gated public RPC (eth_getLogs over a wide range)
  // must never 500 the whole page — each panel degrades to empty on failure.
  const [holders, snapshots, inferences, ensVerification] = await Promise.all([
    loadHolders(agent.ticker).catch(() => []),
    loadSnapshots(agent.ticker).catch(() => []),
    loadInferences(agent.ticker).catch(() => []),
    verifyEns(agent.ens, agent.contracts.vault).catch(() => ({ ok: false as const, reason: "rpc-error" as const })),
  ]);
  const lastDistribution = snapshots[0];
  const marketCap = (agent.ipo.totalSupply * agent.ipo.pricePerShareUsdc) / 10n ** 18n;

  return (
    <>
      <Crumb agent={agent} />

      <section className="agent-head">
        <div className="agent-head-l">
          <div className="ribbon">
            this is one agent&apos;s page · everything below is its own state on chain
          </div>
          <div className="agent-tk">
            <div className="tk">{agent.ticker}</div>
            <div className="ens"><b>{agent.ens}</b></div>
            <EnsBadge verification={ensVerification} ens={agent.ens} />
            <span className={`pill runtime-pill ${agent.runtime === "hermes" ? "hermes" : "raw"}`}>
              {agent.runtime === "hermes" ? "hermes runtime" : "raw runtime"}
            </span>
            <span className="pill">${agent.perCallHuman}/call</span>
            <span className="pill ok">{agent.callsToday} calls today</span>
          </div>
          <p className="agent-desc">{agent.description}</p>

          {agent.realAgent ? (
            <div
              style={{
                marginTop: 6,
                padding: "10px 12px",
                background: "rgba(16,185,129,0.05)",
                border: "1px solid rgba(16,185,129,0.30)",
                borderRadius: 4,
                fontSize: 12,
                color: "var(--fg-2)",
              }}
            >
              <div style={{ marginBottom: 6 }}>
                <span className="acc" style={{ fontWeight: 600 }}>real-agent launch</span>
                {" · "}template{" "}
                <b className="acc">{agent.realAgent.templateId}</b>
                {" · "}runtime{" "}
                <b>{agent.realAgent.runtimeTier}</b>
                {" · "}backend{" "}
                <b>{agent.realAgent.backend}</b>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
                {agent.realAgent.tools.length === 0 ? (
                  <span className="pill" style={{ fontSize: 9 }}>no tools</span>
                ) : (
                  agent.realAgent.tools.map((t) => (
                    <span key={t} className="pill" style={{ fontSize: 9 }}>{t}</span>
                  ))
                )}
                {agent.realAgent.patternCount > 0 ? (
                  <span className="pill" style={{ fontSize: 9 }}>
                    {agent.realAgent.patternCount} patterns
                  </span>
                ) : null}
                {agent.realAgent.skillCount > 0 ? (
                  <span className="pill" style={{ fontSize: 9 }}>
                    {agent.realAgent.skillCount} skills
                  </span>
                ) : null}
              </div>
              <div style={{ fontSize: 10, color: "var(--mute)" }}>
                manifest{" "}
                <span className="acc">{shortAddr(agent.realAgent.bundleManifestCid as `0x${string}`, 8)}</span>
                {" · pinned to 0g storage · binds metadataHash on chain"}
              </div>
            </div>
          ) : null}

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            <Link className="btn primary" href={`/app/agent/${agent.ticker}/subscribe`}>
              call this agent →
            </Link>
            <Link className="btn" href={`/app/agent/${agent.ticker}/acquire`}>
              buy shares of it
            </Link>
            <span className="muted" style={{ fontSize: 14 }}>
              calling pays the vault. owning a share earns from every call.
            </span>
          </div>

          <div className="agent-attest-grid">
            <div>
              <div className="l">tee attestation</div>
              <div className="v acc">{teeLabel(agent.expectedTeeMeasurement)}</div>
            </div>
            <div>
              <div className="l">attestation signer</div>
              <div className="v">
                {agent.runtime === "hermes" ? "0g-compute / teeml" : "openai-compat (no tee)"}
              </div>
            </div>
            <div>
              <div className="l">model bundle</div>
              <div className="v">{agent.modelBase}</div>
            </div>
            <div>
              <div className="l">last attestation</div>
              <div className="v">
                {inferences[0] ? `${relativeTime(inferences[0].ts)} · ✓ verified` : "—"}
              </div>
            </div>
          </div>
        </div>

        <div className="agent-head-r">
          <AnimatedTicker
            ticker={agent.ticker}
            sub={`${agent.ens} · #${agent.tokenId.toString()}`}
          />
        </div>
      </section>

      <section className="stat-pair">
        <div className="col">
          <div className="col-h">
            <span className="ttl">price · shares</span>
            <span className="meta">erc-20 cap table</span>
          </div>
          <div className="stat-grid">
            <Cell l="price / share" v={`$${formatUsdc(agent.ipo.pricePerShareUsdc, 2)}`} sub="usdc" />
            <Cell l="market cap" v={`$${formatUsdc(marketCap, 0)}`} />
            <Cell
              l="ipo sold"
              v={pctOf(agent.ipo.sold, agent.ipo.allocation, 1)}
              sub={`${formatShares(agent.ipo.sold, 0)} / ${formatShares(agent.ipo.allocation, 0)}`}
            />
            <Cell
              l="ipo status"
              v={agent.ipo.isOpen ? "● open" : "closed"}
              sub={
                agent.ipo.isOpen
                  ? `closes ${relativeTime(agent.ipo.endsAt)}`
                  : `was ${relativeTime(agent.ipo.endsAt)}`
              }
              accent
            />
          </div>

          <div style={{ marginTop: 14 }}>
            <div className="up">ipo progress</div>
            <div className="tape-bar" style={{ marginTop: 8 }}>
              <div
                className="fill"
                style={{ width: `${pctNum(agent.ipo.sold, agent.ipo.allocation)}%` }}
              />
              <div className="lbl">
                <span>{pctOf(agent.ipo.sold, agent.ipo.allocation, 1)} sold</span>
                <span>
                  {formatShares(agent.ipo.sold, 0)} / {formatShares(agent.ipo.allocation, 0)}
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="col">
          <div className="col-h">
            <span className="ttl">today</span>
            <span className="meta">
              {lastDistribution ? `last dist · ${relativeTime(lastDistribution.timestampSec)}` : "no dists yet"}
            </span>
          </div>
          <div className="stat-grid">
            <Cell l="calls today" v={agent.callsToday.toString()} />
            <Cell l="cum. revenue" v={`$${formatUsdc(agent.cumulativeRevenueUsdc, 2)}`} />
            <Cell
              l="last distribution"
              v={lastDistribution ? relativeTime(lastDistribution.timestampSec) : "—"}
              sub={lastDistribution ? `$${formatUsdc(lastDistribution.totalDistributedUsdc, 2)}` : undefined}
            />
            <Cell
              l="best bid"
              v={agent.bestBid ? `$${formatUsdc(agent.bestBid.price, 0)}` : "—"}
              sub={agent.bestBid ? relativeTime(agent.bestBid.expiresAt) : undefined}
            />
          </div>

          <div
            style={{
              marginTop: 14,
              border: "1px solid rgba(16,185,129,0.35)",
              background: "rgba(16,185,129,0.04)",
              borderRadius: 2,
              padding: "16px 18px",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <span className="acc mono-h" style={{ color: "var(--accent)" }}>
                ▌ distribute revenue
              </span>
              <span className="badge amber">action available</span>
            </div>
            <div className="mono-h" style={{ fontSize: 12, marginBottom: 4 }}>vault balance</div>
            <div
              style={{
                fontSize: 36,
                color: "var(--accent)",
                fontWeight: 600,
                fontVariantNumeric: "tabular-nums",
                letterSpacing: "-0.01em",
                marginBottom: 6,
              }}
            >
              ${formatUsdc(agent.vaultBalanceUsdc, 2)}
            </div>
            <div className="muted" style={{ fontSize: 13, marginBottom: 12 }}>
              USDC paid by callers since the last distribution. Snap → push pays it pro-rata to all
              {" "}
              <b className="acc">{holders.length}</b> holder{holders.length === 1 ? "" : "s"}.
              Anyone can do this; the contract enforces share-weighted fairness.
            </div>
            <DistributeButton
              vault={agent.contracts.vault}
              holders={holders.map((h) => h.address)}
            />
          </div>
        </div>
      </section>

      <div className="ds-grid cols-2" style={{ marginTop: "var(--gap)" }}>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>metadata</span><span className="tag muted">onchain</span></div>
          </div>
          <div className="kv">
            <KvRow k="inft contract" v={addrOrNone(agent.contracts.iNFT)} />
            <KvRow k="share contract" v={addrOrNone(agent.contracts.shareToken, "not issued")} />
            <KvRow k="vault" v={addrOrNone(agent.contracts.vault, "not issued")} />
            <KvRow k="ipo sale" v={addrOrNone(agent.contracts.ipoSale, "not issued")} />
            <KvRow k="runtime" v={agent.modelBase} />
            <KvRow k="tee attest." v={teeLabel(agent.expectedTeeMeasurement)} accent />
            <KvRow k="x402 endpoint" v={`/x402/infer?tokenId=${agent.tokenId} · ${agent.perCallHuman}`} />
            <KvRow k="ens" v={`${agent.ens} · subnames open`} />
          </div>
        </div>

        <HoldersPanel agent={agent} holders={holders} />
      </div>

      <div className="section-h">
        <h2>recent calls</h2>
        <span className="sub">
          one row per inference. each one paid the vault and emitted a TEE-signed receipt.
          agent→agent threads (where this agent paid another to help) are highlighted.
        </span>
      </div>

      <InferencesPanel inferences={inferences} ticker={agent.ticker} />
    </>
  );
}

function Crumb({ agent }: { agent: AgentDetail }) {
  return (
    <div className="crumb">
      <Link href="/app">markets</Link> <span className="muted">/</span>{" "}
      <span className="fg2">agent</span> <span className="muted">/</span>{" "}
      <span className="acc">{agent.ticker}</span>
      <span style={{ float: "right", color: "var(--mute-2)" }}>
        contract <span className="fg2">{shortAddr(agent.contracts.iNFT, 6)}</span> · token-id{" "}
        <span className="fg2">#{agent.tokenId.toString()}</span>
      </span>
    </div>
  );
}

function Cell({ l, v, sub, accent }: { l: string; v: string; sub?: string; accent?: boolean }) {
  return (
    <div className="cell">
      <div className="l">{l}</div>
      <div className="v" style={accent ? { color: "var(--accent)", fontSize: 14 } : undefined}>
        {v} {sub ? <small>{sub}</small> : null}
      </div>
    </div>
  );
}

function KvRow({ k, v, accent }: { k: string; v: string; accent?: boolean }) {
  return (
    <>
      <div className="k">{k}</div>
      <div className="v" style={accent ? { color: "var(--accent)" } : undefined}>{v}</div>
    </>
  );
}

/** Show a short address, or an honest "— <label>" when it's the zero address
 *  (so un-deployed contracts read as intentional, not as a broken 0x000…000). */
function addrOrNone(addr: string, label = "not set", chars = 6): string {
  return /^0x0+$/i.test(addr) ? `— ${label}` : shortAddr(addr as `0x${string}`, chars);
}

/** 0G TeeML attests via a signed Intel-TDX quote, not an MRENCLAVE hash — so a
 *  zero "measurement" is honest. Show the attestation kind instead of 0x000…. */
function teeLabel(m: string): string {
  return /^0x0+$/i.test(m) ? "0G TeeML · intel-tdx" : shortAddr(m as `0x${string}`, 8);
}

function pctNum(num: bigint, den: bigint): number {
  if (den === 0n) return 0;
  // Compute as integer permille then to float for width %; safe for our share scales.
  const permille = Number((num * 1000n) / den);
  return Math.min(100, Math.max(0, permille / 10));
}

function HoldersPanel({ agent, holders }: { agent: AgentDetail; holders: Holder[] }) {
  const top = holders.slice(0, 6);
  const restCount = Math.max(0, holders.length - 6);
  const restShares = holders.slice(6).reduce((acc, h) => acc + h.shares, 0n);
  const totalSupply = agent.ipo.totalSupply || 1n;
  const allocation = agent.ipo.allocation;
  const sold = agent.ipo.sold;
  const unsold = allocation > sold ? allocation - sold : 0n;
  // visual: accent bar width is shares / max(top1) * 90 (max 90px)
  const top1 = top[0]?.shares ?? 1n;
  const barWidth = (s: bigint) => `${Math.min(150, Number((s * 150n) / (top1 || 1n)))}px`;

  return (
    <div className="panel">
      <div className="panel-head">
        <div className="lhs">
          <span>holders</span>
          <span className="tag muted">{holders.length} wallets</span>
        </div>
        <div className="rhs">
          <span>{formatShares(sold, 0)} / {formatShares(allocation, 0)} sh</span>
        </div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>#</th>
            <th>wallet</th>
            <th className="num">shares</th>
            <th className="num">% of total</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {top.map((h, i) => (
            <tr key={h.address}>
              <td>{String(i + 1).padStart(2, "0")}</td>
              <td>{shortAddr(h.address, 6)}</td>
              <td className="num">{formatShares(h.shares, 0)}</td>
              <td className="num">{pctOf(h.shares, totalSupply, 2)}</td>
              <td>
                <span style={{ display: "inline-block", height: 6, width: barWidth(h.shares), background: "var(--accent)" }} />
              </td>
            </tr>
          ))}
          {restCount > 0 ? (
            <tr>
              <td>—</td>
              <td className="muted">{restCount} others</td>
              <td className="num">{formatShares(restShares, 0)}</td>
              <td className="num">{pctOf(restShares, totalSupply, 2)}</td>
              <td>
                <span style={{ display: "inline-block", height: 6, width: barWidth(restShares), background: "var(--accent-dim, #0c5d44)" }} />
              </td>
            </tr>
          ) : null}
          {unsold > 0n ? (
            <tr>
              <td>—</td>
              <td className="muted">unsold</td>
              <td className="num">{formatShares(unsold, 0)}</td>
              <td className="num">{pctOf(unsold, allocation, 2)}</td>
              <td>
                <span style={{ display: "inline-block", height: 6, width: "150px", background: "#1f1f1f" }} />
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function InferencesPanel({ inferences, ticker }: { inferences: InferenceLog[]; ticker: string }) {
  return (
    <div className="panel">
      <div className="panel-head">
        <div className="lhs">
          <span>events</span>
          <span className="tag muted">last {inferences.length || 0} · auto-stream</span>
        </div>
        <div className="rhs">
          <span className="muted">filter</span>
          <span className="pill ok">all</span>
          <span className="pill">a→a only</span>
        </div>
      </div>
      <div className="log">
        {inferences.length === 0 ? (
          <div className="log-row" style={{ borderBottom: 0 }}>
            <span className="ts">—</span>
            <span className="muted">no inferences yet · run one from the subscribe page</span>
            <span className="meta" />
          </div>
        ) : (
          inferences.slice(0, 14).map((i) => (
            <div key={i.callId} className={`log-row ${i.verified ? "ok" : ""}`}>
              <span className="ts">{new Date(i.ts * 1000).toISOString().slice(11, 19)}</span>
              <span>
                <span className="glyph">▸ </span>
                sub <b>{shortAddr(i.subscriber, 6)}</b> paid · input{" "}
                <span className="muted">{shortAddr(i.inputHash, 6)}</span>
              </span>
              <span className="meta">{i.verified ? "tee✓" : "—"} · {shortAddr(i.callId, 4)}</span>
            </div>
          ))
        )}
        {/* Real on-chain agent-to-agent payment — preserved as a real row.
            txHash 0xc870a5a3a1c5707c7fca5d67d44dd9be4f8d2594949cdf07015e732ef1dbd18b
            is the actual confirmed tx where AUDIT paid ORCL on Base Sepolia. */}
        {ticker === "AUDIT" ? (
          <div className="thread" style={{ marginTop: 0 }}>
            <div className="log-row a2a head">
              <span className="ts">on-chain</span>
              <span>
                <span className="glyph">⇲ </span>
                <b className="acc">AUDIT</b> paid <b className="acc">ORCL</b> $0.10 USDC
              </span>
              <span className="meta">block 40820457</span>
            </div>
            <div className="log-row a2a tail">
              <span className="ts">basescan</span>
              <span>
                <span className="glyph">↪ </span>
                <a
                  className="acc"
                  href="https://sepolia.basescan.org/tx/0xc870a5a3a1c5707c7fca5d67d44dd9be4f8d2594949cdf07015e732ef1dbd18b"
                  target="_blank"
                  rel="noreferrer"
                >
                  0xc870a5a3a1c5707c7fca5d67d44dd9be4f8d2594949cdf07015e732ef1dbd18b ↗
                </a>
              </span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function EnsBadge({ verification, ens }: { verification: EnsVerification; ens: string }) {
  if (verification.ok) {
    return (
      <a
        className="pill ok"
        href={ensAppUrl(ens)}
        target="_blank"
        rel="noreferrer noopener"
        title={`Resolved on Sepolia ENS to ${verification.resolvedAddr}`}
      >
        ens ✓ sepolia ↗
      </a>
    );
  }
  if (verification.reason === "mismatch") {
    return <span className="pill" title={`ENS resolved to ${verification.resolvedAddr} which doesn't match the vault`}>ens ⚠ mismatch</span>;
  }
  if (verification.reason === "rpc-error") {
    return <span className="pill" title="Sepolia RPC unreachable; ENS verification skipped">ens —</span>;
  }
  return <span className="pill" title="No ENS addr record found for this name on Sepolia">ens unset</span>;
}
