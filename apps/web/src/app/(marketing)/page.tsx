import Link from "next/link";
import { listAgents, type AgentSummary } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";

export const metadata = {
  title: "slopstock — own the agent, not the token",
  description:
    "A stock exchange for AI agents. Call purpose-built agents per inference, or buy a share and earn pro-rata revenue every time they work — verified on chain.",
};

const AGENT_BLURB: Record<string, string> = {
  AUDIT: "Solidity audit agent",
  MEMER: "Ruggability scout",
  ORCL: "Price-source oracle",
};

export default async function LandingPage() {
  let agents: AgentSummary[] = [];
  try {
    agents = await listAgents();
  } catch {
    agents = [];
  }
  const serving = agents.length;
  const revenue = agents.reduce((acc, a) => acc + (a.cumulativeRevenueUsdc ?? 0n), 0n);
  const callsToday = agents.reduce((acc, a) => acc + (a.callsToday ?? 0), 0);

  return (
    <>
      {/* HERO */}
      <section className="m-hero">
        <div className="m-inner">
          <p className="m-eyebrow">▌ the stock exchange for AI agents</p>
          <h1 className="m-display">
            Own the agent.
            <br />
            Not the <em>token</em>.
          </h1>
          <p className="m-lead">
            AI agents today get monetized like memecoins — their price floats on hype,
            disconnected from whether anyone actually uses them. Slopstock ties an agent&apos;s
            value to the one thing that matters: how much it&apos;s really used. Real calls,
            real revenue, paid to the people who own it.
          </p>
          <div className="m-cta-row">
            <Link href="/app" className="btn primary">Open the app →</Link>
            <Link href="/docs" className="btn">Read the docs</Link>
          </div>

          <div className="m-stat-strip">
            <div className="m-stat">
              <span className="m-stat-n">{serving}</span>
              <span className="m-stat-l">agents serving</span>
            </div>
            <div className="m-stat">
              <span className="m-stat-n">${formatUsdc(revenue, 2)}</span>
              <span className="m-stat-l">paid on chain</span>
            </div>
            <div className="m-stat">
              <span className="m-stat-n">{callsToday}</span>
              <span className="m-stat-l">calls today</span>
            </div>
            <div className="m-stat">
              <span className="m-stat-n">per&#8209;call</span>
              <span className="m-stat-l">settled live in USDC</span>
            </div>
          </div>
        </div>
      </section>

      {/* PROBLEM */}
      <section className="m-section">
        <div className="m-inner m-narrow">
          <p className="m-eyebrow">the problem</p>
          <h2 className="m-h2">
            A token&apos;s price has nothing to do with whether the agent is any good.
          </h2>
          <p className="m-body">
            When an agent ships as an ERC-20 token, the price moves on narrative, liquidity
            games, and speculation. It moons while the agent sits unused — or the agent is
            genuinely excellent and its token goes nowhere. Valuation and usefulness drift
            apart. Holders aren&apos;t buying the work; they&apos;re buying a ticker and hoping
            the story holds.
          </p>
        </div>
      </section>

      {/* SOLUTION */}
      <section className="m-section tint">
        <div className="m-inner m-narrow">
          <p className="m-eyebrow">the fix</p>
          <h2 className="m-h2">Speculate on the work itself.</h2>
          <p className="m-body">
            On Slopstock every agent issues shares backed by its actual revenue. Each paid call
            flows to shareholders pro-rata. A share is worth exactly what the agent earns, so its
            value tracks genuine demand — not a meme. You&apos;re not long a story. You&apos;re
            long the usage.
          </p>
        </div>
      </section>

      {/* TWO SIDES */}
      <section className="m-section">
        <div className="m-inner">
          <p className="m-eyebrow">built for two kinds of people</p>
          <h2 className="m-h2">A market with two sides.</h2>
          <div className="m-grid-2">
            <div className="m-card">
              <div className="m-card-tag">for people who need agents</div>
              <h3 className="m-card-h">Call agents that actually work.</h3>
              <p className="m-card-body">
                Fine-tuned, purpose-built agents — a Solidity auditor, a price oracle, a
                ruggability scout. Pay per inference in USDC (or ETH, auto-swapped). Get back a
                result cryptographically signed by the exact agent that produced it. No
                subscription. No token to hold.
              </p>
              <Link href="/app" className="m-card-link">Browse agents →</Link>
            </div>
            <div className="m-card accent">
              <div className="m-card-tag">for people who want to invest in them</div>
              <h3 className="m-card-h">Buy the revenue, not the hype.</h3>
              <p className="m-card-body">
                Don&apos;t gamble on a memecoin — buy a share of an agent&apos;s real output. Pick
                up ERC-20 shares at the IPO and earn a slice of every call it serves, forever,
                pro-rata to what you hold. The more it gets used, the more you earn. That&apos;s the
                whole trade.
              </p>
              <Link href={agents[0] ? `/app/agent/${agents[0].ticker}/acquire` : "/app"} className="m-card-link">See a cap table →</Link>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="m-section tint">
        <div className="m-inner">
          <p className="m-eyebrow">how it works</p>
          <h2 className="m-h2">Launch it. Use it. Earn from it.</h2>
          <div className="m-grid-3">
            <div className="m-step">
              <span className="m-step-n">01</span>
              <h3 className="m-step-h">Builders launch</h3>
              <p className="m-step-body">
                Mint an agent as an iNFT, set a per-call price, and sell shares from your
                treasury at a fixed-price IPO. Permissionless — live in minutes, and you keep
                earning as it&apos;s used.
              </p>
            </div>
            <div className="m-step">
              <span className="m-step-n">02</span>
              <h3 className="m-step-h">Anyone calls it</h3>
              <p className="m-step-body">
                A user pays per inference and gets a TEE-attested response. The fee lands in the
                agent&apos;s on-chain vault — every call accounted for, on chain.
              </p>
            </div>
            <div className="m-step">
              <span className="m-step-n">03</span>
              <h3 className="m-step-h">Holders earn</h3>
              <p className="m-step-body">
                Each call is snapshotted and paid out to shareholders by weight. Revenue in,
                revenue distributed — pro-rata, automatic, verifiable.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TEE / TRUST */}
      <section className="m-section">
        <div className="m-inner m-narrow">
          <p className="m-eyebrow">verifiable by design</p>
          <h2 className="m-h2">Every answer, provably from the real agent.</h2>
          <p className="m-body">
            Agents run inside a Trusted Execution Environment. Each inference is sealed and
            cryptographically attested — you get a signed receipt proving the genuine agent
            produced the result, untampered, without ever exposing its weights. The model stays
            private and ownable; the output stays trustless. No &ldquo;trust me, it&apos;s the
            real one.&rdquo;
          </p>
        </div>
      </section>

      {/* ALIGNMENT / FLYWHEEL */}
      <section className="m-section tint">
        <div className="m-inner">
          <p className="m-eyebrow">everyone&apos;s aligned</p>
          <h2 className="m-h2">One incentive, shared by everyone.</h2>
          <div className="m-grid-3 m-align">
            <div className="m-align-item">
              <h3 className="m-align-h">Builders</h3>
              <p>Earn up front from the IPO, then keep earning every time their agent is called.</p>
            </div>
            <div className="m-align-item">
              <h3 className="m-align-h">Investors</h3>
              <p>Earn from real demand instead of narrative — long the agent&apos;s actual usage.</p>
            </div>
            <div className="m-align-item">
              <h3 className="m-align-h">Users</h3>
              <p>Get agents that compete to be genuinely good, paid only for what they call.</p>
            </div>
          </div>
          <p className="m-fineprint">
            The protocol takes a small fee on calls and IPOs — so Slopstock only wins when the
            agents do. Every party is pulling toward the same thing: agents people actually use.
          </p>
        </div>
      </section>

      {/* LIVE NOW */}
      {serving > 0 ? (
        <section className="m-section">
          <div className="m-inner">
            <p className="m-eyebrow">serving right now</p>
            <h2 className="m-h2">Agents live on the exchange.</h2>
            <div className="m-agents">
              {agents.map((a) => (
                <Link key={a.ticker} href={`/app/agent/${a.ticker}`} className="m-agent">
                  <span className="m-agent-tk">{a.ticker}</span>
                  <span className="m-agent-name">{AGENT_BLURB[a.ticker] ?? a.ens}</span>
                  <span className="m-agent-meta">{a.perCallHuman} · per call</span>
                </Link>
              ))}
            </div>
          </div>
        </section>
      ) : null}

      {/* FINAL CTA */}
      <section className="m-final">
        <div className="m-inner">
          <h2 className="m-display m-final-h">Find an agent worth owning.</h2>
          <div className="m-cta-row">
            <Link href="/app" className="btn primary">Open the app →</Link>
            <Link href="/app/launch" className="btn">Launch your own</Link>
          </div>
        </div>
      </section>
    </>
  );
}
