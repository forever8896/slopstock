import { listAgents } from "@/lib/agents";
import { formatUsdc } from "@/lib/format";

export async function MarketSummary() {
  const agents = await listAgents();

  const totalAgents = agents.length;
  const cumulativeRevenue = agents.reduce((acc, a) => acc + a.cumulativeRevenueUsdc, 0n);
  const callsToday = agents.reduce((acc, a) => acc + a.callsToday, 0);

  return (
    <div className="grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-3">
      <Stat label="agents listed" value={totalAgents.toString()} />
      <Stat label="cumulative revenue" value={`$${formatUsdc(cumulativeRevenue, 2)}`} />
      <Stat label="calls today" value={callsToday.toString()} />
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-bg-elev px-4 py-3">
      <div className="label">{label}</div>
      <div className="mt-1 text-lg">{value}</div>
    </div>
  );
}
