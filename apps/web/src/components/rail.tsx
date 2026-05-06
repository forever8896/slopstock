/**
 * Wizard step indicator — used by /launch (template → identity → review →
 * go-live) and /subscribe (compose → pay → run → receipt).
 *
 * Renders horizontal numbered steps with hairline bars between, ✓ for done,
 * accent fill for active, mute for upcoming.
 *
 *   <Rail steps={["template","identity","review","go-live"]} current={1} />
 */
interface RailProps {
  steps: string[];
  /** zero-indexed current step; everything below it shows "done", at it "active". */
  current: number;
}

export function Rail({ steps, current }: RailProps) {
  return (
    <div className="ss-rail">
      {steps.map((s, i) => {
        const cls = i < current ? "step done" : i === current ? "step active" : "step";
        return (
          <span key={s} style={{ display: "contents" }}>
            <div className={cls}>
              <span className="num">
                <span>{String(i + 1).padStart(2, "0")}</span>
              </span>
              <span>{s}</span>
            </div>
            {i < steps.length - 1 ? (
              <div className={"bar" + (i < current ? " done" : "")} />
            ) : null}
          </span>
        );
      })}
    </div>
  );
}
