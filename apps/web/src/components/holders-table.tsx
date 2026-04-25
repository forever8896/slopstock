import { formatShares, pctOf, shortAddr } from "@/lib/format";
import type { MockAgent, MockHolder } from "@/lib/mock";

export function HoldersTable({ agent, holders }: { agent: MockAgent; holders: MockHolder[] }) {
  const total = agent.ipo.totalSupply;
  return (
    <div className="panel">
      <div className="border-b border-border px-4 py-3">
        <div className="label">top holders</div>
      </div>
      <div>
        {holders.map((h) => (
          <div
            key={h.address}
            className="grid grid-cols-12 border-b border-border px-4 py-2 text-sm last:border-b-0"
          >
            <div className="col-span-7 text-text-muted">{shortAddr(h.address, 6)}</div>
            <div className="col-span-3 text-right">{formatShares(h.shares, 0)}</div>
            <div className="col-span-2 text-right text-text-muted">{pctOf(h.shares, total, 1)}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
