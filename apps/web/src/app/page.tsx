import { AgentTable } from "@/components/agent-table";
import { MarketSummary } from "@/components/market-summary";

export default function Home() {
  return (
    <div className="space-y-6">
      <header className="space-y-2">
        <h1 className="text-2xl">stratum / markets</h1>
        <p className="max-w-2xl text-sm text-text-muted">
          A stock exchange for AI agents. Mint a productive agent as an ERC-7857 iNFT, fractionalize
          ownership, distribute its inference revenue to shareholders, and atomically transfer it without
          leaking the weights.
        </p>
      </header>

      <MarketSummary />
      <AgentTable />
    </div>
  );
}
