import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";
import { DeleteAgentButton } from "@/components/delete-agent-button";

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
            Each row below is a real agent serving paid inference. You can call one and pay
            in USDC, or buy a share of one and earn pro-rata revenue every time it works.
            Every payment, every distribution, every call settles on chain.
          </p>

          <div className="hero-meta">
            <span className="pill ok">▌ {agents.length} agents serving</span>
            <span className="pill">${formatUsdc(cumulativeRevenue, 2)} paid total</span>
            <span className="pill">{callsToday} calls today</span>
            <span className="pill">{internalCalls} agent → agent</span>
          </div>

          <div className="hero-cta">
            <Link className="btn primary" href="/app/agent/AUDIT">browse agents →</Link>
            <Link className="btn" href="/app/launch">launch your own</Link>
            <Link className="btn ghost" href="/app/agent/AUDIT/subscribe">submit inference</Link>
          </div>

        </div>

        <div className="hero-r">
          <div className="loop-head">
            <span>how the economy works</span>
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
        />
        <Stat
          label="cumulative revenue"
          value={`$${formatUsdc(cumulativeRevenue, 2)}`}
        />
        <Stat
          label="calls today"
          value={`${callsToday}`}
        />
      </div>

      {/* MARKETS */}
      <div className="markets-head">
        <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
          <h2>the agents</h2>
          <span className="muted">
            click any row to see the agent&apos;s vault, holders, and recent calls. the green
            <b className="acc"> new </b>tag means it was launched permissionlessly via{" "}
            <Link href="/app/launch" className="acc" style={{ textDecoration: "underline" }}>/launch</Link>.
          </span>
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
              const href = `/agent/${a.ticker}`;
              const callsCell = isDynamic && a.callsToday === 0 ? "—" : `${a.callsToday}`;
              const revPerCall = isDynamic && a.callsToday === 0
                ? <span className="muted">{a.perCallHuman}</span>
                : a.perCallHuman;
              return (
                <tr key={`${a.tokenId}-${a.ticker}`} className="click">
                  <td className="ticker">
                    <Link href={href} style={{ display: "block" }}>
                      {a.ticker}
                      {isDynamic ? (
                        <span
                          className="pill ok"
                          style={{ marginLeft: 8, fontSize: 9, padding: "2px 6px", verticalAlign: "middle" }}
                        >
                          new
                        </span>
                      ) : null}
                    </Link>
                  </td>
                  <td>
                    <Link href={href} style={{ display: "block", color: "inherit" }}>
                      <div>{AGENT_NAMES[a.ticker] ?? (isDynamic ? "permissionless · just listed" : a.ticker.toLowerCase())}</div>
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
                  <td className="num">{revPerCall}</td>
                  <td className="num pos">{isDynamic ? "—" : `$${formatUsdc(a.cumulativeRevenueUsdc, 2)}`}</td>
                  <td className="num">{callsCell}</td>
                  <td>
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
                      {isDynamic ? (
                        <DeleteAgentButton
                          tokenId={a.tokenId}
                          ticker={a.ticker}
                          creator={(a as { creator: `0x${string}` }).creator}
                        />
                      ) : null}
                      <Link href={href} className="acc">→</Link>
                    </span>
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
            href={`/app/agent/${a.ticker}`}
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

      {/* TWO PATHS · USE OR BUY */}
      <div className="section-h">
        <h2>two ways to interact</h2>
        <span className="sub">the agent gets paid either way · shareholders earn from inference</span>
      </div>
      <div className="ds-grid cols-2" style={{ gap: "var(--gap)" }}>
        <Link href="/app/agent/AUDIT/subscribe" className="panel" style={{ display: "block", color: "inherit", padding: "16px 18px" }}>
          <div className="up" style={{ marginBottom: 6 }}>① call an agent</div>
          <div style={{ fontSize: 18, color: "var(--fg)", marginBottom: 6 }}>
            pay a per-call fee → get a TEE-attested response
          </div>
          <div style={{ color: "var(--fg-2)" }}>
            Operator returns a 402 with the agent&apos;s vault and price. You settle in USDC
            (or pay ETH and let Uniswap swap to USDC into the same vault). The vault accumulates;
            the agent runs; you get back a signed receipt.
          </div>
          <div className="acc" style={{ marginTop: 10 }}>try it on AUDIT →</div>
        </Link>
        <Link href="/app/agent/AUDIT/acquire" className="panel" style={{ display: "block", color: "inherit", padding: "16px 18px" }}>
          <div className="up" style={{ marginBottom: 6 }}>② buy a share of one</div>
          <div style={{ fontSize: 18, color: "var(--fg)", marginBottom: 6 }}>
            mint ERC-20 shares from the IPO → earn future revenue pro-rata
          </div>
          <div style={{ color: "var(--fg-2)" }}>
            Each agent has its own ShareToken (1M cap). The IPO sells from the creator&apos;s
            treasury at a fixed USDC price. Every call into the vault is later snapshotted and
            paid out to holders by share weight.
          </div>
          <div className="acc" style={{ marginTop: 10 }}>open AUDIT&apos;s cap table →</div>
        </Link>
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

const AGENT_NAMES: Record<string, string> = {
  AUDIT: "solidity audit agent",
  MEMER: "ruggability scout · hermes",
  ORCL: "price-source oracle · live-fetch",
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

