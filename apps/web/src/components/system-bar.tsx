"use client";

/**
 * The "ss-bottom" system status bar from the design — sits at the bottom of
 * every page. Live block + gas updates from Base Sepolia via wagmi public
 * client. Falls back to static placeholders if the RPC blips.
 */
import { useEffect, useState } from "react";
import { createPublicClient, http, formatGwei } from "viem";
import { baseSepolia } from "viem/chains";

const pub = createPublicClient({ chain: baseSepolia, transport: http("https://base-sepolia-rpc.publicnode.com") });

export function SystemBar() {
  const [block, setBlock] = useState<bigint | null>(null);
  const [gas, setGas] = useState<string>("—");

  useEffect(() => {
    let cancelled = false;
    async function tick() {
      try {
        const [b, fees] = await Promise.all([
          pub.getBlockNumber(),
          pub.estimateFeesPerGas().catch(() => null),
        ]);
        if (cancelled) return;
        setBlock(b);
        if (fees?.maxFeePerGas) {
          const gwei = formatGwei(fees.maxFeePerGas);
          setGas(Number(gwei).toFixed(3));
        }
      } catch {
        /* ignore */
      }
    }
    tick();
    const id = setInterval(tick, 12_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return (
    <div className="ss-bottom">
      <span>
        <span className="ok">●</span> chains synced
      </span>
      <span>
        block <span className="n" style={{ color: "var(--fg-2)" }}>{block ? block.toString() : "—"}</span>
      </span>
      <span>
        gas <span className="n" style={{ color: "var(--fg-2)" }}>{gas}</span> gwei
      </span>
      <div className="right">
        <span>
          tee attesters: <span className="ok">3 / 3</span>
        </span>
        <span>v0.4 · stratum</span>
      </div>
    </div>
  );
}
