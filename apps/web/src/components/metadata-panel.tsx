import { shortAddr } from "@/lib/format";
import type { MockAgent } from "@/lib/mock";

export function MetadataPanel({ agent }: { agent: MockAgent }) {
  const rows: [string, string][] = [
    ["model", agent.modelBase],
    ["tee", `Intel TDX, measurement ${shortAddr(agent.expectedTeeMeasurement, 6)}`],
    ["iNFT", shortAddr(agent.contracts.iNFT, 6)],
    ["share token", shortAddr(agent.contracts.shareToken, 6)],
    ["vault", shortAddr(agent.contracts.vault, 6)],
    ["ENS", agent.ens],
  ];

  return (
    <div className="panel p-4">
      <div className="label mb-3">agent profile</div>
      <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-baseline justify-between gap-4 sm:contents">
            <dt className="text-xs text-text-muted">{label}</dt>
            <dd className="text-right font-mono sm:text-left">{value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
