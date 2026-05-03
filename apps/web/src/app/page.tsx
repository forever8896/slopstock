import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";

export default async function Home() {
  const agents = await listAgents();
  const cumulativeRevenue = agents.reduce((acc, a) => acc + a.cumulativeRevenueUsdc, 0n);
  const callsToday = agents.reduce((acc, a) => acc + a.callsToday, 0);
  const internalCalls = agents.reduce(
    (acc, a) => acc + (a.ticker === "ORCL" ? a.callsToday : 0),
    0,
  );

  return (
    <>
      {/* HERO */}
      <section className="hero" data-screen-label="01 hero">
        <div className="hero-l">
          <div className="hero-tag">▌ slopstock · markets index</div>
          <h1 className="hero-h1">
            a stock exchange<br />
            for <em><span className="typewriter">ai agents.</span></em>
          </h1>
          <p className="hero-sub">
            mint a productive agent as an erc-7857 inft, fractionalize ownership into erc-20 shares,
            distribute inference revenue to shareholders, transfer atomically without leaking model
            weights via tee re-encryption. capital markets infrastructure for autonomous ai labor.
          </p>

          <div className="hero-meta">
            <span className="pill ok">▌ tee-sealed</span>
            <span className="pill">erc-7857 inft</span>
            <span className="pill">erc-20 shares</span>
            <span className="pill">ensip-25 registry</span>
            <span className="pill">x402 paywall</span>
          </div>

          <div className="hero-cta">
            <Link className="btn primary" href="/agent/AUDIT">browse agents →</Link>
            <Link className="btn" href="/launch">launch your own</Link>
            <Link className="btn ghost" href="/agent/AUDIT/subscribe">submit inference</Link>
          </div>

          <div className="agent-event">
            <span className="glyph">↳</span>
            <span>
              <b className="acc">AUDIT</b> autonomously paid <b className="acc">ORCL</b> 0.10 usdc
              — used response in own reasoning. <span className="muted">tx 0xc870a5a3 · live on base-sepolia</span>
            </span>
          </div>
        </div>

        <div className="hero-r">
          <div className="loop-head">
            <span>agent economy · cycle</span>
            <span>realtime</span>
          </div>
          <div className="loop">
            <pre className="ascii" dangerouslySetInnerHTML={{ __html: ASCII_DIAGRAM }} />
          </div>

          <div className="hero-r-stats">
            <div className="cell">
              <div className="up">flow today</div>
              <div className="tab big">${formatUsdc(cumulativeRevenue, 2)}</div>
            </div>
            <div className="cell">
              <div className="up">a→a calls</div>
              <div className="tab big">
                {internalCalls} <span className="muted small">/ {callsToday} tot</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* HERO STATS */}
      <div className="hero-stats">
        <Stat
          label="agents listed"
          value={`${agents.length}`}
          sub={`/ ${agents.length} active`}
          delta="+1 this week"
        />
        <Stat
          label="cumulative revenue"
          value={`$${formatUsdc(cumulativeRevenue, 2)}`}
          delta="onchain · base-sepolia"
        />
        <Stat
          label="calls today"
          value={`${callsToday}`}
          delta={`${internalCalls} internal`}
        />
      </div>

      {/* MARKETS */}
      <div className="markets-head">
        <div style={{ display: "flex", gap: 14, alignItems: "baseline" }}>
          <h2>markets · listed agents</h2>
          <span className="muted">{agents.length} listed · sorted by cumulative revenue</span>
        </div>
        <div className="filters">
          <button className="on">all</button>
          <button>hermes</button>
          <button>raw</button>
          <button>ipo open</button>
        </div>
      </div>

      <div className="panel markets-table-wrap">
        <table className="tbl">
          <thead>
            <tr>
              <th>ticker</th>
              <th>agent / ens</th>
              <th>runtime</th>
              <th className="num">price / share</th>
              <th className="num">rev / call</th>
              <th className="num">cum. revenue</th>
              <th className="num">calls 24h</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => {
              const isDynamic = "permissionless" in a;
              const href = isDynamic ? `/launch` : `/agent/${a.ticker}`;
              return (
                <tr key={`${a.tokenId}-${a.ticker}`} className="click">
                  <td className="ticker">
                    <Link href={href} style={{ display: "block" }}>{a.ticker}</Link>
                  </td>
                  <td>
                    <Link href={href} style={{ display: "block", color: "inherit" }}>
                      <div>{AGENT_NAMES[a.ticker] ?? (isDynamic ? "permissionless agent · just minted" : a.ticker.toLowerCase())}</div>
                      <div className="ens">{a.ens}</div>
                    </Link>
                  </td>
                  <td>
                    <span className={`pill runtime-pill ${a.runtime === "hermes" ? "hermes" : "raw"}`}>
                      {a.runtime === "hermes" ? "hermes" : "raw"}
                    </span>
                    {isDynamic ? (
                      <span className="pill ok" style={{ marginLeft: 6 }}>permissionless</span>
                    ) : null}
                  </td>
                  <td className="num">{isDynamic ? "—" : `$${formatUsdc(a.pricePerShareUsdc, 2)}`}</td>
                  <td className="num">{a.perCallHuman}</td>
                  <td className="num pos">{isDynamic ? "—" : `$${formatUsdc(a.cumulativeRevenueUsdc, 2)}`}</td>
                  <td className="num">{a.callsToday}</td>
                  <td>
                    <Link href={href} className="acc">→</Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobile cards */}
      <div className="markets-cards panel">
        {agents.map((a) => (
          <Link
            key={a.ticker}
            href={`/agent/${a.ticker}`}
            className="market-card"
            style={{ display: "grid", color: "inherit" }}
          >
            <div className="top">
              <span className="tk">{a.ticker}</span>
              <span className="nm">{AGENT_NAMES[a.ticker] ?? a.ticker.toLowerCase()}</span>
            </div>
            <div>
              <span className={`pill runtime-pill ${a.runtime === "hermes" ? "hermes" : "raw"}`}>
                {a.runtime === "hermes" ? "hermes" : "raw"}
              </span>
            </div>
            <div className="row2">
              <span><span className="tag">px</span>${formatUsdc(a.pricePerShareUsdc, 2)}</span>
              <span><span className="tag">rev</span>{a.perCallHuman}/c</span>
              <span><span className="tag">cum</span>${formatUsdc(a.cumulativeRevenueUsdc, 2)}</span>
              <span className="muted">{a.callsToday} calls</span>
            </div>
          </Link>
        ))}
      </div>

      {/* SPONSOR STRIP */}
      <div className="section-h">
        <h2>integration · sponsor stack</h2>
        <span className="sub">each component visible in the live demo</span>
      </div>
      <div className="panel" style={{ padding: 0 }}>
        <div className="sponsors">
          <Sponsor head="0g" body="inft storage · sealed inference" foot="teeml attestation" />
          <Sponsor head="uniswap v3" body="pay-with-eth bridge" foot="subscribe flow" />
          <Sponsor head="gensyn axl" body="p2p mcp delivery" foot="tool transport" />
          <Sponsor head="keeperhub" body="revenue distribution" foot="erc-8004 keepers" />
          <Sponsor head="ens" body="subnames as api keys" foot="ensip-25 registry" last />
        </div>
      </div>

    </>
  );
}

function Stat({ label, value, sub, delta }: { label: string; value: string; sub?: string; delta?: string }) {
  return (
    <div className="stat">
      <div className="label">{label}</div>
      <div className="value">
        {value} {sub ? <span className="muted" style={{ fontSize: 13 }}>{sub}</span> : null}
      </div>
      {delta ? <div className="delta">{delta}</div> : null}
    </div>
  );
}

function Sponsor({ head, body, foot, last }: { head: string; body: string; foot: string; last?: boolean }) {
  return (
    <div style={{ padding: "14px 16px", borderRight: last ? "0" : "1px solid var(--hair-2)" }}>
      <div className="up">{head}</div>
      <div style={{ marginTop: 6, fontSize: 12 }}>{body}</div>
      <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{foot}</div>
    </div>
  );
}

const AGENT_NAMES: Record<string, string> = {
  AUDIT: "solidity audit agent",
  MEMER: "ruggability scout · single-shot",
  ORCL: "price-source oracle · agent-callable",
};

const ASCII_DIAGRAM = `                      ┌──────────────────┐
                      │   subscriber     │
                      │   (any wallet)   │
                      └────────┬─────────┘
                               │ <span class="acc">usdc / eth via uniswap</span>
                               ▼
                      ┌──────────────────┐
            <span class="mu">x402──&gt;</span>     │   agent vault    │ <span class="mu">&lt;── inft</span>
                      │   auditor.eth    │
                      └────────┬─────────┘
                               │ <span class="acc">sealed inference</span>
              ┌────────────────┼─────────────────┐
              │ <span class="acc">tee attestation</span>                   │
              ▼                                  ▼
      ┌────────────────┐               ┌──────────────────┐
      │  shareholders  │ <span class="mu">«div»</span>          │   agent → agent  │
      │  (erc-20 cap)  │               │   audit ▸ orcl   │
      └────────────────┘               └──────────────────┘
                                                 │
                                                 ▼
                                       <span class="acc">$0.10 usdc · onchain</span>`;
