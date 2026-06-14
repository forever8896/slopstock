// apps/web/src/components/docs/harness-matrix.tsx

/**
 * The runtime × backend routing matrix. Rows = runtime (the layer above the LLM
 * call); columns = compute backend (where the call physically goes). Each cell
 * describes the resulting behavior. Source of truth: apps/operator/src/runtime/index.ts.
 */
const RUNTIMES = [
  { key: "hermes", label: "hermes", blurb: "stateful loop · tools · skills · memory" },
  { key: "openai-compat", label: "openai-compat", blurb: "single-shot LLM call, stateless" },
];
const BACKENDS = [
  { key: "0g-compute", label: "0g-compute", blurb: "sealed, TEE-attested (Intel TDX / H100/H200)" },
  { key: "openai-compat", label: "openai-compat", blurb: "any OpenAI-shaped HTTP endpoint" },
];
const CELLS: Record<string, string> = {
  "hermes|0g-compute": "Full harness on sealed inference — the production path for launched agents (deepseek-v4-flash on 0G mainnet).",
  "hermes|openai-compat": "Full harness on a plain endpoint — local/dev (Ollama, OpenRouter). Stateful, unsealed.",
  "openai-compat|0g-compute": "One sealed call, no state — cheap attested inference without the agent loop.",
  "openai-compat|openai-compat": "One plain call — the simplest baseline.",
};

export function HarnessMatrix() {
  return (
    <figure className="docs-matrix">
      <div className="docs-matrix-grid">
        <div className="docs-matrix-corner">runtime ↓ / backend →</div>
        {BACKENDS.map((b) => (
          <div key={b.key} className="docs-matrix-head">
            <span className="docs-matrix-key">{b.label}</span>
            <span className="docs-matrix-blurb">{b.blurb}</span>
          </div>
        ))}
        {RUNTIMES.map((r) => (
          <FragmentRow key={r.key} rLabel={r.label} rBlurb={r.blurb} rKey={r.key} />
        ))}
      </div>
      <figcaption className="docs-matrix-cap">
        Selection per tokenId: <code>RUNTIME_BY_TOKEN_ID</code> → <code>AGENT_RUNTIME</code> →
        {" "}<code>BACKEND_BY_TOKEN_ID</code> → <code>COMPUTE_BACKEND</code>. Launched agents always route to hermes on 0g-compute.
      </figcaption>
    </figure>
  );
}

function FragmentRow({ rLabel, rBlurb, rKey }: { rLabel: string; rBlurb: string; rKey: string }) {
  return (
    <>
      <div className="docs-matrix-head row">
        <span className="docs-matrix-key">{rLabel}</span>
        <span className="docs-matrix-blurb">{rBlurb}</span>
      </div>
      {BACKENDS.map((b) => (
        <div key={b.key} className={`docs-matrix-cell ${rKey === "hermes" && b.key === "0g-compute" ? "primary" : ""}`}>
          {CELLS[`${rKey}|${b.key}`]}
        </div>
      ))}
    </>
  );
}
