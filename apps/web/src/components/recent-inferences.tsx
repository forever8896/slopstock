import { relativeTime, shortAddr } from "@/lib/format";
import type { MockInferenceLog } from "@/lib/mock";

export function RecentInferences({ entries }: { entries: MockInferenceLog[] }) {
  return (
    <div className="panel">
      <div className="border-b border-border px-4 py-3">
        <div className="label">recent inferences (with attestations)</div>
      </div>
      <ul>
        {entries.map((e) => (
          <li
            key={e.callId}
            className="grid grid-cols-12 items-center border-b border-border px-4 py-2 text-sm last:border-b-0"
          >
            <div className="col-span-3 text-text-muted">{relativeTime(e.ts)}</div>
            <div className="col-span-5 truncate font-mono text-xs text-text-muted">
              input {shortAddr(e.inputHash, 8)}
            </div>
            <div className="col-span-2 text-text-muted">{shortAddr(e.subscriber, 4)}</div>
            <div className="col-span-2 text-right">
              {e.verified ? (
                <span className="text-accent-green">verified ✓</span>
              ) : (
                <span className="text-accent-red">unverified ⚠</span>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
