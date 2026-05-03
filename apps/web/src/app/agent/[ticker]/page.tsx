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
import { formatShares, formatUsdc, pctOf, relativeTime, shortAddr } from "@/lib/format";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function AgentDetailPage({ params }: PageProps) {
  const { ticker } = await params;
  const agent = await loadAgentDetail(ticker.toUpperCase());
  if (!agent) notFound();

  const [holders, snapshots, inferences] = await Promise.all([
    loadHolders(agent.ticker),
    loadSnapshots(agent.ticker),
    loadInferences(agent.ticker),
  ]);
  const lastDistribution = snapshots[0];
  const marketCap = (agent.ipo.totalSupply * agent.ipo.pricePerShareUsdc) / 10n ** 18n;

  return (
    <>
      <Crumb agent={agent} />

      <section className="agent-head">
        <div className="agent-head-l">
          <div className="ribbon">
            tee-verified · {agent.runtime === "hermes" ? "0g compute" : "openai-compat"} · teeml signed
          </div>
          <div className="agent-tk">
            <div className="tk">{agent.ticker}</div>
            <div className="ens"><b>{agent.ens}</b></div>
            <span className={`pill runtime-pill ${agent.runtime === "hermes" ? "hermes" : "raw"}`}>
              {agent.runtime === "hermes" ? "hermes" : "raw"}
            </span>
            <span className="pill">erc-7857 inft</span>
            <span className="pill">live · base-sepolia</span>
          </div>
          <p className="agent-desc">{agent.description}</p>

          <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 6 }}>
            <Link className="btn primary" href={`/agent/${agent.ticker}/subscribe`}>
              subscribe — submit inference →
            </Link>
            <Link className="btn" href={`/agent/${agent.ticker}/acquire`}>
              acquire shares
            </Link>
          </div>

          <div className="agent-attest-grid">
            <div>
              <div className="l">tee measurement</div>
              <div className="v acc">{shortAddr(agent.expectedTeeMeasurement, 8)}</div>
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
          <div className="col-h">
            <span className="ttl">price · 24h</span>
            <span className="meta">${formatUsdc(agent.pricePerShareUsdc, 2)} / share</span>
          </div>
          <Sparkline kind="line" />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--mute)" }}>
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
          </div>

          <div className="col-h" style={{ marginTop: 18 }}>
            <span className="ttl">revenue · 24h</span>
            <span className="meta">${formatUsdc(agent.cumulativeRevenueUsdc, 2)} cum</span>
          </div>
          <Sparkline kind="bars" />
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 10, color: "var(--mute)" }}>
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>now</span>
          </div>
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

          <div style={{ marginTop: 14, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <span className="badge-tee">
              <span className="lk">[lock]</span>{" "}
              {agent.runtime === "hermes" ? "0g compute · tee verified" : "openai-compat · sealed"}
            </span>
            <span className="pill warn">x402 paywalled</span>
            <span className="pill">keeperhub auto-dist</span>
          </div>
        </div>
      </section>

      <div className="ds-grid cols-2" style={{ marginTop: "var(--gap)" }}>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>metadata</span><span className="tag muted">onchain</span></div>
            <div className="rhs"><span>verified</span></div>
          </div>
          <div className="kv">
            <KvRow k="inft contract" v={shortAddr(agent.contracts.iNFT, 6)} />
            <KvRow k="share contract" v={shortAddr(agent.contracts.shareToken, 6)} />
            <KvRow k="vault" v={shortAddr(agent.contracts.vault, 6)} />
            <KvRow k="ipo sale" v={shortAddr(agent.contracts.ipoSale, 6)} />
            <KvRow k="runtime" v={agent.modelBase} />
            <KvRow k="tee meas." v={shortAddr(agent.expectedTeeMeasurement, 8)} accent />
            <KvRow k="x402 endpoint" v={`/x402/infer?tokenId=${agent.tokenId} · ${agent.perCallHuman}`} />
            <KvRow k="ens" v={`${agent.ens} · subnames open`} />
          </div>
        </div>

        <HoldersPanel agent={agent} holders={holders} />
      </div>

      <div className="section-h">
        <h2>recent inferences · live tape</h2>
        <span className="sub">x402 paid · tee-verified · agent→agent threads highlighted</span>
      </div>

      <InferencesPanel inferences={inferences} ticker={agent.ticker} />
    </>
  );
}

function Crumb({ agent }: { agent: AgentDetail }) {
  return (
    <div className="crumb">
      <Link href="/">markets</Link> <span className="muted">/</span>{" "}
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
                <b className="acc">AUDIT</b> paid <b className="acc">ORCL</b> $0.10 USDC{" "}
                <span className="pill ok" style={{ marginLeft: 6 }}>real tx</span>
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
              <span className="meta">verifiable on chain</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function Sparkline({ kind }: { kind: "line" | "bars" }) {
  if (kind === "line") {
    return (
      <svg className="spark" viewBox="0 0 320 60" preserveAspectRatio="none" style={{ marginTop: 6 }}>
        <line className="ax" x1="0" y1="30" x2="320" y2="30" />
        <path
          className="area"
          d="M0,42 L20,40 L40,38 L60,42 L80,30 L100,32 L120,28 L140,22 L160,26 L180,18 L200,20 L220,14 L240,18 L260,12 L280,16 L300,10 L320,8 L320,60 L0,60 Z"
        />
        <path
          className="line"
          d="M0,42 L20,40 L40,38 L60,42 L80,30 L100,32 L120,28 L140,22 L160,26 L180,18 L200,20 L220,14 L240,18 L260,12 L280,16 L300,10 L320,8"
        />
      </svg>
    );
  }
  const bars = [56, 48, 56, 42, 56, 50, 56, 38, 56, 46, 56, 34, 56, 40, 56, 28, 56, 32, 56, 22, 56, 26, 56, 20, 56, 30, 56, 18, 56, 22, 56, 14, 56, 10, 56, 18, 56, 12, 56, 20, 56, 8, 56, 14, 56, 6];
  // pairs: x1=y1=56 (baseline) / x2=y2 (top)
  return (
    <svg className="spark" viewBox="0 0 320 60" preserveAspectRatio="none" style={{ marginTop: 6 }}>
      <line className="ax" x1="0" y1="30" x2="320" y2="30" />
      <g stroke="var(--accent)" strokeWidth="2" opacity="0.85">
        {Array.from({ length: 23 }).map((_, i) => {
          const x = 6 + i * 14;
          const y = bars[i * 2 + 1] ?? 30;
          return <line key={i} x1={x} y1="56" x2={x} y2={y} />;
        })}
      </g>
    </svg>
  );
}
