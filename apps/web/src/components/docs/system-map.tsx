// apps/web/src/components/docs/system-map.tsx

/**
 * Top-level architecture map as labelled layers. Each layer is a band with a
 * role label and the components living in it. Declarative so content MDX can
 * tune it; defaults reflect the current stack.
 */
export interface MapLayer {
  role: string;
  nodes: string[];
}

const DEFAULT_LAYERS: MapLayer[] = [
  { role: "Surfaces", nodes: ["Landing", "App (exchange)", "Docs"] },
  { role: "Identity", nodes: ["ENS (L1)", "ERC-8004 registry (Base)", "ENSIP-25 verify"] },
  { role: "Settlement", nodes: ["Base mainnet", "x402 v2", "USDC (EIP-3009)"] },
  { role: "Compute", nodes: ["Operator node", "Hermes harness", "0G compute (sealed TEE)"] },
  { role: "Storage", nodes: ["Walrus blobs", "Seal (threshold IBE)", "ENS agent-snapshot pointer"] },
];

export function SystemMap({ layers = DEFAULT_LAYERS }: { layers?: MapLayer[] }) {
  return (
    <figure className="docs-sysmap">
      {layers.map((layer) => (
        <div key={layer.role} className="docs-sysmap-layer">
          <span className="docs-sysmap-role">{layer.role}</span>
          <div className="docs-sysmap-nodes">
            {layer.nodes.map((n) => (
              <span key={n} className="docs-sysmap-node">{n}</span>
            ))}
          </div>
        </div>
      ))}
    </figure>
  );
}
