import { notFound } from "next/navigation";
import { AgentHeader } from "@/components/agent-header";
import { HoldersTable } from "@/components/holders-table";
import { MetadataPanel } from "@/components/metadata-panel";
import { RecentInferences } from "@/components/recent-inferences";
import { StatCard } from "@/components/stat-card";
import { loadAgentDetail, loadHolders, loadInferences, loadSnapshots } from "@/lib/agents";
import { formatUsdc, pctOf, relativeTime } from "@/lib/format";

interface PageProps {
  params: Promise<{ ticker: string }>;
}

export default async function AgentDetail({ params }: PageProps) {
  const { ticker } = await params;
  const agent = await loadAgentDetail(ticker.toUpperCase());
  if (!agent) notFound();

  const [holders, snapshots, inferences] = await Promise.all([
    loadHolders(agent.ticker),
    loadSnapshots(agent.ticker),
    loadInferences(agent.ticker),
  ]);
  const lastDistribution = snapshots[0];

  const marketCap = (agent.ipo.totalSupply * agent.ipo.pricePerShareUsdc) / 10n ** 18n;

  return (
    <div className="space-y-6">
      <AgentHeader agent={agent} />

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
            {
              label: "ipo status",
              value: agent.ipo.isOpen ? (
                <span className="text-accent-green">open</span>
              ) : (
                <span className="text-text-muted">closed</span>
              ),
              hint: agent.ipo.isOpen
                ? `closes ${relativeTime(agent.ipo.endsAt)}`
                : `was ${relativeTime(agent.ipo.endsAt)}`,
            },
          ]}
        />

        <StatCard
          title="today"
          rows={[
            { label: "calls today", value: agent.callsToday.toString() },
            { label: "cumulative revenue", value: <>${formatUsdc(agent.cumulativeRevenueUsdc, 2)}</> },
            {
              label: "last distribution",
              value: lastDistribution ? relativeTime(lastDistribution.timestampSec) : "—",
              hint: lastDistribution
                ? `$${formatUsdc(lastDistribution.totalDistributedUsdc, 2)} paid out`
                : undefined,
            },
            {
              label: "best bid",
              value: agent.bestBid
                ? `$${formatUsdc(agent.bestBid.price, 2)}`
                : "—",
              hint: agent.bestBid ? `expires ${relativeTime(agent.bestBid.expiresAt)}` : undefined,
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
