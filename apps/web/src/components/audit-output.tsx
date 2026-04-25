/**
 * Render structured audit findings. The hero agent (auditor.stratum.eth)
 * returns JSON shaped per docs/08-hero-agent.md §4.2; we parse defensively
 * and fall back to raw display if the JSON doesn't validate.
 */

interface Finding {
  id?: string;
  severity?: "HIGH" | "MEDIUM" | "LOW" | "INFORMATIONAL";
  title?: string;
  location?: { file?: string; lines?: number[] };
  description?: string;
  recommendation?: string;
}

interface AuditPayload {
  summary?: string;
  findings?: Finding[];
  summaryStats?: { high?: number; medium?: number; low?: number; informational?: number };
  modelMeta?: { model?: string; version?: string };
}

const sevColor: Record<string, string> = {
  HIGH: "text-accent-red border-accent-red",
  MEDIUM: "text-yellow-400 border-yellow-400",
  LOW: "text-blue-400 border-blue-400",
  INFORMATIONAL: "text-text-muted border-text-muted",
};

export function AuditOutput({ raw }: { raw: string }) {
  let parsed: AuditPayload | undefined;
  try {
    parsed = JSON.parse(raw) as AuditPayload;
  } catch {
    parsed = undefined;
  }

  if (!parsed || !parsed.findings) {
    // Graceful fallback for non-JSON or unexpected shapes.
    return (
      <pre className="panel max-h-96 overflow-auto whitespace-pre-wrap p-4 text-xs">
        {raw}
      </pre>
    );
  }

  const stats = parsed.summaryStats ?? {};
  return (
    <div className="space-y-4">
      <div className="panel p-4">
        <div className="label mb-2">summary</div>
        <p className="text-sm">{parsed.summary ?? "—"}</p>
        <div className="mt-3 flex flex-wrap gap-2 text-xs">
          {stats.high ? <SeverityChip sev="HIGH" count={stats.high} /> : null}
          {stats.medium ? <SeverityChip sev="MEDIUM" count={stats.medium} /> : null}
          {stats.low ? <SeverityChip sev="LOW" count={stats.low} /> : null}
          {stats.informational ? <SeverityChip sev="INFORMATIONAL" count={stats.informational} /> : null}
        </div>
        {parsed.modelMeta?.model ? (
          <div className="mt-3 text-xs text-text-muted">
            model: <span className="text-text-primary">{parsed.modelMeta.model}</span>
            {parsed.modelMeta.version ? <span> · v{parsed.modelMeta.version}</span> : null}
          </div>
        ) : null}
      </div>

      <div className="panel">
        <div className="border-b border-border px-4 py-3">
          <div className="label">findings ({parsed.findings.length})</div>
        </div>
        <ul>
          {parsed.findings.map((f, i) => (
            <li key={f.id ?? i} className="space-y-2 border-b border-border px-4 py-3 last:border-b-0">
              <div className="flex items-baseline gap-3">
                <span className={`border px-1.5 py-0.5 text-xs uppercase ${sevColor[f.severity ?? "INFORMATIONAL"]}`}>
                  {f.severity ?? "info"}
                </span>
                <span className="text-sm font-semibold">{f.title ?? "(untitled)"}</span>
                {f.location ? (
                  <span className="text-xs text-text-muted">
                    {f.location.file ?? ""}
                    {f.location.lines && f.location.lines.length > 0 ? `:${f.location.lines.join(",")}` : ""}
                  </span>
                ) : null}
              </div>
              {f.description ? (
                <p className="text-xs text-text-muted">{f.description}</p>
              ) : null}
              {f.recommendation ? (
                <p className="text-xs">
                  <span className="text-accent-green">↳ </span>
                  <span>{f.recommendation}</span>
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function SeverityChip({ sev, count }: { sev: keyof typeof sevColor; count: number }) {
  return (
    <span className={`border px-1.5 py-0.5 ${sevColor[sev]}`}>
      {sev} {count}
    </span>
  );
}
