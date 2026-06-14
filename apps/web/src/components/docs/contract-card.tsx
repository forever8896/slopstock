// apps/web/src/components/docs/contract-card.tsx
import { AddressPill } from "./address-pill";

export function ContractCard({ name, chain, responsibility, address, addrKind = "base" }: {
  name: string;
  chain: string;
  responsibility: string;
  address?: string;
  addrKind?: "base" | "eth" | "ens" | "none";
}) {
  return (
    <div className="docs-contract">
      <div className="docs-contract-head">
        <span className="docs-contract-name">{name}</span>
        <span className="docs-contract-chain">{chain}</span>
      </div>
      <p className="docs-contract-resp">{responsibility}</p>
      {address ? <AddressPill value={address} kind={addrKind} /> : null}
    </div>
  );
}
