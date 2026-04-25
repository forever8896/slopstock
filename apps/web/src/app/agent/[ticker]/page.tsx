import { notFound } from "next/navigation";
import { AgentHeader } from "@/components/agent-header";
import { HoldersTable } from "@/components/holders-table";
import { MetadataPanel } from "@/components/metadata-panel";
import { MockBanner } from "@/components/mock-banner";
import { RecentInferences } from "@/components/recent-inferences";
import { StatCard } from "@/components/stat-card";
import { findMockAgent, mockHolders, mockInferences, mockSnapshots } from "@/lib/mock";
import { formatUsdc, pctOf, relativeTime } from "@/lib/format";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function AgentDetail({ params }: PageProps) {
  const { ticker } = await params;
  const agent = findMockAgent(ticker.toUpperCase());
  if (!agent) notFound();

  const holders = mockHolders[agent.ticker] ?? [];
  const snapshots = mockSnapshots[agent.ticker] ?? [];
  const inferences = mockInferences[agent.ticker] ?? [];
  const lastDistribution = snapshots[0]; // freshest

  const marketCap = (agent.ipo.totalSupply * agent.ipo.pricePerShareUsdc) / 10n ** 18n;

  return (
    <div className="space-y-6">
      <AgentHeader agent={agent} />
      <MockBanner note="Holders, snapshots, and inference history are simulated. Live data will replace this once the indexer is wired." />

      <div className="grid gap-4 md:grid-cols-2">
        <StatCard
          title="price & shares"
          rows={[
            { label: "price", value: <>${formatUsdc(agent.ipo.pricePerShareUsdc, 2)} / share</> },
            {
              label: "ipo sold",
              value: (
                <>
                  {pctOf(agent.ipo.sold, agent.ipo.allocation, 1)}{" "}
                  <span className="text-text-muted">({formatUsdc(agent.ipo.sold / 10n ** 18n, 0)} shares)</span>
                </>
              ),
            },
            { label: "market cap", value: <>${formatUsdc(marketCap, 0)}</> },
          ]}
        />

        <StatCard
          title="today"
          rows={[
            { label: "calls today", value: agent.revenue.callsToday.toString() },
            { label: "7d revenue", value: <>${formatUsdc(agent.revenue.last7dUsdc, 2)}</> },
            { label: "cumulative revenue", value: <>${formatUsdc(agent.revenue.cumulativeUsdc, 2)}</> },
            {
              label: "last distribution",
              value: lastDistribution ? relativeTime(lastDistribution.timestampSec) : "—",
              hint: lastDistribution ? `$${formatUsdc(lastDistribution.totalDistributedUsdc, 2)} paid out` : undefined,
            },
          ]}
        />
      </div>

      <MetadataPanel agent={agent} />
      <HoldersTable agent={agent} holders={holders} />
      <RecentInferences entries={inferences} />
    </div>
  );
}
