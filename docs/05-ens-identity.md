# 05 — ENS Identity Layer

## 1. Goal

ENS does **four** things in our system, all load-bearing — none cosmetic:

1. **Ticker / handle** — `auditor.stratum.eth` is how humans and other agents refer to the agent.
2. **Discovery** — ENSIP-25 registers the agent so other agents can find it via the AI Agent Registry.
3. **Rotating treasury addresses** — CCIP-Read returns a different address per resolution call so receive funds get fresh ephemeral wallets per session.
4. **Subnames as revocable subscriber API keys** — `key-abc.subscribers.auditor.stratum.eth` is a session credential that resolves to permission metadata via text records.

These map to ENS's two prize tracks:
- **Best ENS Integration for AI Agents:** items 1 + 2 (real identity)
- **Most Creative Use of ENS:** items 3 + 4 (rotating addresses + subnames-as-credentials)

We hit both in one stack.

## 2. Name hierarchy

```
stratum.eth                                       (parent — we register at hackathon start)
├── auditor.stratum.eth                           (hero agent)
│   ├── treasury.auditor.stratum.eth              (CCIP-Read returns rotating addresses)
│   ├── api.auditor.stratum.eth                   (text record: discovery URL)
│   └── subscribers/
│       ├── 0xabc...123.subscribers.auditor.stratum.eth   (subscriber-bound subname)
│       └── ...                                            (each minted on subscribe)
├── alpha.stratum.eth                             (stretch — second agent)
└── _registry.stratum.eth                         (root pointer for ENSIP-25 lookups)
```

## 3. Implementation strategy: CCIP-Read offchain resolver (Durin pattern)

We don't write a thousand on-chain subnames. We use a single CCIP-Read resolver on Sepolia (or L1 mainnet if we get an ENS name early) that delegates to an HTTP gateway for any name in the `*.stratum.eth` subtree.

### 3.1 Resolver contract (Sepolia)

```solidity
contract StratumResolver is IExtendedResolver {
    string public gatewayURL;        // https://stratum.app/api/ens/resolve
    address public gatewaySigner;    // pubkey we use to sign responses

    constructor(string memory _url, address _signer) {
        gatewayURL = _url;
        gatewaySigner = _signer;
    }

    /// EIP-3668 OffchainLookup: tells client to fetch from gateway and re-call us
    function resolve(bytes calldata name, bytes calldata data)
        external view returns (bytes memory)
    {
        string[] memory urls = new string[](1);
        urls[0] = gatewayURL;
        revert OffchainLookup(
            address(this),
            urls,
            abi.encodeWithSelector(IGatewayCallback.queryENS.selector, name, data),
            this.resolveWithProof.selector,
            abi.encode(name, data)
        );
    }

    function resolveWithProof(bytes calldata response, bytes calldata extraData)
        external view returns (bytes memory)
    {
        // verify signature on response from our gateway signer
        (bytes memory result, uint256 expires, bytes memory sig) =
            abi.decode(response, (bytes, uint256, bytes));
        require(block.timestamp < expires, "expired");
        bytes32 digest = keccak256(abi.encodePacked(extraData, result, expires));
        require(_recover(digest, sig) == gatewaySigner, "bad sig");
        return result;
    }
}
```

### 3.2 Gateway HTTP service

A Cloudflare Worker (or Vercel Edge Function). One file, ~250 LoC TypeScript. Endpoints:

```
POST /api/ens/resolve
  body: { name: encodedName, data: encodedFunctionCall }
  returns: { result, expires, sig }
```

The worker:
1. Decodes the ENS name + function selector (e.g., `addr(bytes32)`, `text(bytes32,string)`).
2. Looks up the requested name in our backing store.
3. Computes the answer (possibly time/caller-dependent — see below).
4. Signs `keccak256(extraData || result || expires)` with `gatewaySigner` private key.
5. Returns.

The gateway signer's private key lives in Vercel/Cloudflare secrets. It only proves the gateway said something; a compromise leaks signing capability but not user funds.

## 4. The four uses, concrete implementation

### 4.1 Ticker / handle (basic addr resolution)

`auditor.stratum.eth` resolves to the operator's address (or the iNFT contract for "agent's primary identity"). Standard ENS.

Backing store row:
```json
{ "name": "auditor.stratum.eth", "addr": "0xOPERATOR" }
```

### 4.2 Discovery via ENSIP-25 AI Agent Registry

ENSIP-25 (currently on the ENS docs sidebar but underexplored) defines text records for an "AI Agent" profile:

```
text:agent.name         "auditor"
text:agent.description  "Sealed Solidity audit agent"
text:agent.endpoint     "https://stratum.app/agent/AUDIT/.well-known/agent.json"
text:agent.protocol     "x402"
text:agent.capabilities "solidity_audit"
text:agent.pricing      "USDC:1.00/call"
text:agent.tokenId      "42"
text:agent.shareToken   "0xSHARE_0G"
text:agent.vault        "0xVAULT_BASE"
```

The well-known JSON document at `agent.endpoint` is the full agent card per Google A2A / Anthropic MCP discovery conventions:

```json
{
  "schemaVersion": "ai/agent/v1",
  "name": "auditor.stratum.eth",
  "description": "Sealed Solidity security audit agent",
  "ownership": {
    "iNFT": "eip155:16600/erc7857:0xAGENT/42",
    "shareToken": "eip155:16600/erc20:0xSHARE_0G",
    "fractional": true
  },
  "endpoints": {
    "infer": { "transport": "axl|http", "x402": true, "price": "1 USDC.base" },
    "mcp":   { "transport": "axl", "address": "ipv6://200:..." }
  },
  "verification": {
    "tee": { "vendor": "intel-tdx", "expectedMeasurement": "0x..." }
  }
}
```

### 4.3 Rotating treasury addresses (the "most creative" trick)

`treasury.auditor.stratum.eth` is a CCIP-Read-backed name. Each call to `addr()` returns a **different fresh address** derived from an HD wallet seed.

Why: privacy-preserving donation/tip address that doesn't link payments together; also useful for "fresh receive address per inference session" if subscribers prefer that.

```ts
// gateway pseudocode
function resolveAddr(name: string, callerInfo: CallerInfo): Address {
  if (name === "treasury.auditor.stratum.eth") {
    const idx = nextIndex();   // monotonic counter, persisted
    const fresh = hdWallet.deriveChild(idx).address;
    persist({ idx, fresh, ts: Date.now() });
    return fresh;
  }
  return staticLookup(name);
}
```

**Sweep logic:** a tiny KeeperHub workflow (or simple Vercel cron) sweeps each derived address into the canonical RevenueVault every N minutes. Funds aren't actually fragmented in practice — the rotation is a privacy/UX feature.

### 4.4 Subnames as revocable subscriber API keys

When a subscriber pays for `authorizeUsage`, we mint them a subname:

`<subscriber_addr>.subscribers.auditor.stratum.eth`

with text records:
```
text:subscriber.tokenId        "42"
text:subscriber.expiresAt      "1745800000"
text:subscriber.scopes         "infer:audit"
text:subscriber.signedGrant    "0x..."   (operator-signed authorization blob)
```

The subname **does not actually exist on-chain** — it's purely served by the CCIP-Read gateway, and the gateway only resolves it if there's an active `authorizeUsage` grant on-chain. When the grant expires or is revoked, the subname stops resolving.

This is genuinely novel: the **subname's resolution is an oracle for on-chain authorization**. Any third party can do `text("subscriber.signedGrant")` and verify the subscriber's permission without calling any custom API.

## 5. Dentity Verifiable Credentials

ENS supports VCs in text records via the Dentity standard (W3C VC). We add one:

`text:agent.audit-passed` = signed VC from a "Stratum reviewer" key (us) attesting "this agent passed Stratum's safety eval v1." The VC is a JWT with a known issuer; anyone can verify.

For the demo, the issuer is us — but the *primitive* is what matters: the agent's ENS profile carries cryptographically verifiable claims about it.

In a real deployment, an independent reviewer issues these (parallel to S&P credit ratings). Mention this framing to judges.

## 6. ENSIP-25 registration

We don't have to deploy a registry — ENSIP-25 specifies the text-record schema. Registration is just setting the right text records on `auditor.stratum.eth`. Discovery is then by anyone who indexes ENSIP-25-shaped names.

For the demo we add a small `_registry.stratum.eth` text record:

```
text:registry.agents = JSON list of all our agents:
  [
    { "name": "auditor.stratum.eth", "tokenId": 42 },
    { "name": "alpha.stratum.eth",   "tokenId": 43 }   // stretch
  ]
```

Other agents can fetch this list and discover us. Effectively a public agent yellow-pages.

## 7. Hackathon-pragmatic naming

Buying `stratum.eth` on mainnet during a hackathon is risky (registration races, expiry, $1k/yr fees for short names). Two pragmatic paths:

| Path | Pros | Cons |
|---|---|---|
| **Use Sepolia testnet ENS** | Free, fast, no race | Judges might dock for "not real ENS" — but ENS docs explicitly support testnet for hackathons |
| **Use a subname under a name we already own** (e.g., `stratum.<your-name>.eth` on mainnet via NameStone or Namespace) | Real mainnet ENS | Requires a sponsor/partner relationship |

**Default plan:** Sepolia ENS, with a very visible "deploys identically to mainnet" line in our README. ENS judges have explicitly noted they accept testnet for hackathons (verify Hour 0).

## 8. Components inventory

| File | Lines | Purpose |
|---|---|---|
| `contracts/StratumResolver.sol` | ~150 | CCIP-Read offchain resolver |
| `gateway/index.ts` (Cloudflare Worker) | ~250 | HTTP responder + signer |
| `scripts/setup-ens.ts` | ~80 | One-shot: register stratum.eth, set resolver, wire subnames |
| `scripts/mint-subscriber-subname.ts` | ~40 | Called when authorizeUsage is granted |
| `frontend/components/ENSCard.tsx` | ~100 | Shows agent's full ENS profile |

**Total:** ~600 LoC. ~6h for one ENS-fluent dev.

## 9. Verification commands (judges should be able to run)

```bash
# 1. resolve the agent's name
$ ens-resolver resolve auditor.stratum.eth
0xOPERATOR_ADDR

# 2. read its ENSIP-25 records
$ ens-resolver text auditor.stratum.eth agent.endpoint
https://stratum.app/agent/AUDIT/.well-known/agent.json

# 3. show rotating treasury (3 calls back-to-back, 3 different addrs)
$ ens-resolver resolve treasury.auditor.stratum.eth
0xfresh1...
$ ens-resolver resolve treasury.auditor.stratum.eth
0xfresh2...
$ ens-resolver resolve treasury.auditor.stratum.eth
0xfresh3...

# 4. show that the subscriber subname only resolves with an active grant
$ ens-resolver text 0xSUB.subscribers.auditor.stratum.eth subscriber.signedGrant
0xsigned...
$ # revoke on-chain
$ cast send 0xAGENT "revokeUsage(uint256,address)" 42 0xSUB
$ ens-resolver text 0xSUB.subscribers.auditor.stratum.eth subscriber.signedGrant
(error: name does not resolve — grant expired)
```

This is the demo gold for the ENS prize.

## 10. Hackathon-specific gotchas

- **Forwards vs. reverse resolution:** judges may also check `addr → name` reverse. We set the reverse record for the operator address to point back to `auditor.stratum.eth`.
- **Caching:** ENS resolvers cache aggressively. To demo rotating addresses, judges must use a fresh client (no curl with caching). Document this in the README + showcase a script that bypasses caches.
- **CCIP-Read client support:** ethers, viem, and the official ENS web app all support CCIP-Read out of the box. wagmi works too. We test all three.

## 11. Why this is non-cosmetic (for judging)

The ENS judging criteria explicitly warns against "cosmetic add-ons." Our load-bearing claims:

1. **Without ENS:** subscribers can't discover the agent without a centralized directory. ENSIP-25 is the directory.
2. **Without ENS:** there's no way to issue a transferable, verifiable subscriber credential without our own custom API. Subnames + text records are the API.
3. **Without ENS rotating addresses:** privacy-preserving tip/donation address requires a custom backend with auth. CCIP-Read does it natively.
4. **Without ENS:** there's no portable, wallet-readable agent profile. The well-known JSON link via text record is the profile.

If a judge asks "could you do this without ENS?", the answer is "yes, but only by re-implementing every one of those features as a centralized service." That's the test.
