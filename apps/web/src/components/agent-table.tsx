import Link from "next/link";
import { mockAgents } from "@/lib/mock";
import { formatUsdc } from "@/lib/format";

export function AgentTable() {
  return (
    <div className="panel">
      <div className="grid grid-cols-12 border-b border-border px-4 py-3 text-xs text-text-muted">
        <div className="col-span-2">ticker</div>
        <div className="col-span-4">name</div>
        <div className="col-span-2 text-right">price</div>
        <div className="col-span-2 text-right">rev / call</div>
        <div className="col-span-2 text-right">7d revenue</div>
      </div>

      {mockAgents.map((a) => (
        <Link
          href={`/agent/${a.ticker}`}
          key={a.ticker}
          className="grid grid-cols-12 px-4 py-3 text-sm hover:bg-bg-elev"
        >
          <div className="col-span-2 flex items-center gap-2">
            <span className="text-accent-green">▌</span>
            <span className="font-semibold">{a.ticker}</span>
          </div>
          <div className="col-span-4 text-text-muted">{a.ens}</div>
          <div className="col-span-2 text-right">${formatUsdc(a.ipo.pricePerShareUsdc, 2)}</div>
          <div className="col-span-2 text-right">{a.pricing.perCallHuman}</div>
          <div className="col-span-2 text-right">${formatUsdc(a.revenue.last7dUsdc, 2)}</div>
        </Link>
      ))}
    </div>
  );
}
