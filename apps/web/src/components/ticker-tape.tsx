import { listAgents } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";

export async function TickerTape() {
  const agents = await listAgents();
  const cells: Array<{ tk: string; px: string; cls: "pos" | "neg"; tag: string; meta: string }> = [];

  for (const a of agents) {
    cells.push({
      tk: a.ticker,
      px: `$${formatUsdc(a.pricePerShareUsdc, 2)}`,
      cls: "pos",
      tag: a.runtime === "hermes" ? "tee✓" : "raw",
      meta: `$${formatUsdc(a.cumulativeRevenueUsdc, 0)} cum`,
    });
  }
  for (const a of agents) {
    cells.push({
      tk: a.ticker,
      px: a.perCallHuman,
      cls: "pos",
      tag: "per-call",
      meta: `${a.callsToday} today`,
    });
  }

  // Doubled for seamless marquee loop
  const loop = [...cells, ...cells];

  return (
    <div className="tape" aria-label="live ticker">
      <div className="tape-track">
        {loop.map((c, i) => (
          <div className="tape-cell" key={i}>
            <span className="tk">{c.tk}</span>
            <span className="tab">{c.px}</span>
            <span className={c.cls}>{c.tag}</span>
            <span className="mu">{c.meta}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
