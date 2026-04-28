import type { AgentStep, InferenceReceipt } from "@stratum/shared";

const KIND_LABEL: Record<AgentStep["kind"], string> = {
  llm: "LLM",
  tool: "TOOL",
  skill_load: "SKILL+",
  skill_create: "SKILL!",
  memory_read: "MEM <",
  memory_write: "MEM >",
};

const KIND_COLOR: Record<AgentStep["kind"], string> = {
  llm: "text-blue-400",
  tool: "text-accent-green",
  skill_load: "text-text-primary",
  skill_create: "text-yellow-400",
  memory_read: "text-text-muted",
  memory_write: "text-text-muted",
};

export function TranscriptView({ receipt }: { receipt: InferenceReceipt }) {
  const transcript = receipt.transcript ?? [];
  if (transcript.length === 0) return null;

  return (
    <details className="panel p-4 text-xs">
      <summary className="label cursor-pointer">
        agent transcript — {transcript.length} step{transcript.length === 1 ? "" : "s"}
      </summary>
      <ul className="mt-3 space-y-1 font-mono">
        {transcript.map((step, i) => (
          <li key={i} className="grid grid-cols-12 gap-2">
            <span className={`col-span-1 ${KIND_COLOR[step.kind]}`}>{KIND_LABEL[step.kind]}</span>
            <span className="col-span-11 text-text-muted break-all">{describe(step)}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function describe(step: AgentStep): string {
  switch (step.kind) {
    case "llm": {
      const tokens =
        step.promptTokens || step.completionTokens
          ? ` · ${step.promptTokens ?? 0}p / ${step.completionTokens ?? 0}c tokens`
          : "";
      return `${step.model}${tokens}`;
    }
    case "tool":
      return `${step.tool}(args=${step.argsHash.slice(0, 14)}…) → ${step.resultSummary}`;
    case "skill_load":
      return `loaded skill: ${step.skill}`;
    case "skill_create":
      return `created skill: ${step.skill}`;
    case "memory_read":
      return `recall("${step.query}") → ${step.resultCount} hits`;
    case "memory_write":
      return `note: ${step.key}`;
  }
}
