import Link from "next/link";
import type { AgentDetail } from "@/lib/agents";

export function AgentHeader({ agent }: { agent: AgentDetail }) {
  return (
    <header className="flex items-start justify-between border-b border-border pb-4">
      <div className="space-y-1">
        <div className="flex items-center gap-3">
          <span className="text-accent-green">▌</span>
          <h1 className="text-2xl font-semibold">{agent.ticker}</h1>
          <span className="text-text-muted">{agent.ens}</span>
        </div>
        <p className="max-w-2xl text-sm text-text-muted">{agent.description}</p>
      </div>
      <div className="flex gap-2">
        <Link
          href={`/app/agent/${agent.ticker}/subscribe`}
          className="border border-border px-3 py-1.5 text-sm hover:border-accent-green hover:text-accent-green"
        >
          subscribe
        </Link>
        <Link
          href={`/app/agent/${agent.ticker}/acquire`}
          className="border border-border bg-bg-elev px-3 py-1.5 text-sm hover:border-accent-red hover:text-accent-red"
        >
          acquire
        </Link>
      </div>
    </header>
  );
}
