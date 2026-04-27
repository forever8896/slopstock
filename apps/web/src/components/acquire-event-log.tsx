import type { EventKind, EventLogEntry } from "@/lib/acquire";

const kindColors: Record<EventKind, string> = {
  post: "text-text-primary",
  tee: "text-blue-400",
  transfer: "text-accent-green",
  revoke: "text-yellow-400",
  ens: "text-blue-400",
  result: "text-accent-green",
  info: "text-text-muted",
  accept: "text-accent-green",
};

const kindLabel: Record<EventKind, string> = {
  post: "POST  ",
  tee: "CALL  ",
  transfer: "EMIT  ",
  revoke: "EMIT  ",
  ens: "EMIT  ",
  result: "RESULT",
  info: "INFO  ",
  accept: "EMIT  ",
};

function formatTs(ts: number): string {
  const d = new Date(ts);
  const hh = d.getHours().toString().padStart(2, "0");
  const mm = d.getMinutes().toString().padStart(2, "0");
  const ss = d.getSeconds().toString().padStart(2, "0");
  const ms = d.getMilliseconds().toString().padStart(3, "0");
  return `${hh}:${mm}:${ss}.${ms}`;
}

export function AcquireEventLog({ events }: { events: EventLogEntry[] }) {
  return (
    <div className="panel">
      <div className="border-b border-border px-4 py-3">
        <div className="label">live event log</div>
      </div>
      {events.length === 0 ? (
        <div className="px-4 py-6 text-xs text-text-muted">
          no events yet — post a bid or accept the demo bid above.
        </div>
      ) : (
        <ul className="divide-y divide-border">
          {events.map((e, i) => (
            <li key={i} className="px-4 py-2 text-xs">
              <div className="flex items-baseline gap-3">
                <span className="text-text-muted">{formatTs(e.ts)}</span>
                <span className={`uppercase ${kindColors[e.kind]}`}>{kindLabel[e.kind]}</span>
                <span className="font-semibold">{e.title}</span>
              </div>
              <ul className="mt-1 space-y-0.5 pl-[10rem] text-text-muted">
                {e.lines.map((line, j) => (
                  <li key={j} className="flex items-baseline gap-2">
                    <span className={kindColors[e.kind]}>▌</span>
                    <span className="break-all">{line}</span>
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
