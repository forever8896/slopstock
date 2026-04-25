/**
 * Single source of "this number is fake" labeling. Reused across pages so the
 * UI is honest at every level.
 */
export function MockBanner({ note }: { note?: string }) {
  return (
    <div className="mb-6 flex items-center gap-2 border border-border bg-bg-elev px-4 py-2 text-xs text-text-muted">
      <span className="text-accent-green">[mock]</span>
      <span>
        {note ?? "Hero agent + holders + revenue history are simulated. Live on-chain reads will replace this once contracts are deployed."}
      </span>
    </div>
  );
}
