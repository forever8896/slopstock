import { mockAgents } from "@/lib/mock";
import { formatUsdc } from "@/lib/format";

export function MarketSummary() {
  const totalAgents = mockAgents.length;
  const cumulativeRevenue = mockAgents.reduce((acc, a) => acc + a.revenue.cumulativeUsdc, 0n);
  const callsToday = mockAgents.reduce((acc, a) => acc + a.revenue.callsToday, 0);

  return (
    <div className="grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-4">
      <Stat label="agents listed" value={totalAgents.toString()} />
      <Stat label="cumulative revenue" value={`$${formatUsdc(cumulativeRevenue, 2)}`} />
      <Stat label="calls today" value={callsToday.toString()} />
      <Stat label="active subscribers" value="4" mock />
    </div>
  );
}

function Stat({ label, value, mock = false }: { label: string; value: string; mock?: boolean }) {
  return (
    <div className="bg-bg-elev px-4 py-3">
      <div className="label">
        {label}
        {mock ? <span className="ml-1 text-accent-green">[mock]</span> : null}
      </div>
      <div className="mt-1 text-lg">{value}</div>
    </div>
  );
}
