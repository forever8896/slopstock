// apps/web/src/components/docs/address-pill.tsx
type Kind = "base" | "eth" | "ens" | "none";

const BASE: Record<Kind, (v: string) => string | undefined> = {
  base: (v) => `https://basescan.org/address/${v}`,
  eth: (v) => `https://etherscan.io/address/${v}`,
  ens: (v) => `https://app.ens.domains/${v}`,
  none: () => undefined,
};

export function AddressPill({ value, kind = "base", label }: { value: string; kind?: Kind; label?: string }) {
  const href = BASE[kind](value);
  const text = label ?? value;
  if (!href) return <span className="docs-addr">{text}</span>;
  return (
    <a className="docs-addr" href={href} target="_blank" rel="noreferrer">{text}</a>
  );
}
