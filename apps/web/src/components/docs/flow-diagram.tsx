// apps/web/src/components/docs/flow-diagram.tsx

/**
 * Declarative lane/step flow diagram — the designed successor to the ASCII
 * flows. Lanes are the actors (columns/legend); each step is an ordered action
 * with an originating lane and an optional target lane. Renders as a vertical
 * sequence of numbered rows with from→to actor chips, which reads well on both
 * desktop and mobile (no SVG layout math required).
 */
export interface FlowStep {
  /** Index of the acting lane (0-based, into `lanes`). */
  from: number;
  /** Index of the target lane, if this step crosses to another actor. */
  to?: number;
  /** What happens. */
  action: string;
  /** Optional on-chain / payload annotation (mono). */
  note?: string;
}

export function FlowDiagram({ title, lanes, steps }: { title?: string; lanes: string[]; steps: FlowStep[] }) {
  return (
    <figure className="docs-flow">
      {title ? <figcaption className="docs-flow-title">{title}</figcaption> : null}
      <div className="docs-flow-lanes">
        {lanes.map((l, i) => (
          <span key={l} className="docs-flow-lane" data-lane={i}>{l}</span>
        ))}
      </div>
      <ol className="docs-flow-steps">
        {steps.map((s, i) => (
          <li key={i} className="docs-flow-step">
            <span className="docs-flow-num">{i + 1}</span>
            <div className="docs-flow-main">
              <div className="docs-flow-actors">
                <span className="docs-flow-chip">{lanes[s.from]}</span>
                {s.to !== undefined ? (
                  <>
                    <span className="docs-flow-arrow" aria-hidden>→</span>
                    <span className="docs-flow-chip">{lanes[s.to]}</span>
                  </>
                ) : null}
              </div>
              <p className="docs-flow-action">{s.action}</p>
              {s.note ? <p className="docs-flow-note">{s.note}</p> : null}
            </div>
          </li>
        ))}
      </ol>
    </figure>
  );
}
