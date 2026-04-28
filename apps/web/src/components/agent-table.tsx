import Link from "next/link";
import { listAgents } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";

export async function AgentTable() {
  const agents = await listAgents();
  return (
    <div className="panel">
      <div className="grid grid-cols-12 border-b border-border px-4 py-3 text-xs text-text-muted">
        <div className="col-span-2">ticker</div>
        <div className="col-span-3">name</div>
        <div className="col-span-2">runtime</div>
        <div className="col-span-1 text-right">price</div>
        <div className="col-span-2 text-right">rev / call</div>
        <div className="col-span-2 text-right">cumulative rev</div>
      </div>

      {agents.map((a) => (
        <Link
          href={`/agent/${a.ticker}`}
          key={a.ticker}
          className="grid grid-cols-12 px-4 py-3 text-sm hover:bg-bg-elev"
        >
          <div className="col-span-2 flex items-center gap-2">
            <span className="text-accent-green">▌</span>
            <span className="font-semibold">{a.ticker}</span>
          </div>
          <div className="col-span-3 text-text-muted">{a.ens}</div>
          <div className="col-span-2">
            <span
              className={
                a.runtime === "hermes"
                  ? "border border-accent-green px-2 py-0.5 text-xs text-accent-green"
                  : "border border-border px-2 py-0.5 text-xs text-text-muted"
              }
            >
              {a.runtime === "hermes" ? "Hermes-pattern" : "raw"}
            </span>
          </div>
          <div className="col-span-1 text-right">${formatUsdc(a.pricePerShareUsdc, 2)}</div>
          <div className="col-span-2 text-right">{a.perCallHuman}</div>
          <div className="col-span-2 text-right">${formatUsdc(a.cumulativeRevenueUsdc, 2)}</div>
        </Link>
      ))}
    </div>
  );
}
