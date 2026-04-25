# 06 — AXL P2P Delivery Layer

## 1. Goal

Subscribers and operators talk peer-to-peer over Gensyn's AXL mesh — **no centralized API gateway**, **no public ingress on either side**, **end-to-end encrypted by AXL itself**. The MCP and A2A protocols ride on top of AXL, so any agent stack that already speaks MCP can use Stratum agents.

Why this matters for prize judging: AXL's qualification requires "communication across separate AXL nodes, not just in-process." The whole demo *naturally* satisfies this because the operator and subscriber are on different machines.

## 2. AXL primer (what it actually is)

From the research dive — recap:

- **Yggdrasil-mesh + gVisor userspace TCP**, exposed as a localhost HTTP bridge.
- **No TUN, no port-forwarding, no root.** App `POST localhost:NNNN/send`, `GET /recv`.
- **MCP and A2A** served *over the mesh* — `/mcp/` and `/a2a/` endpoints proxy to peers.
- **Identity:** ed25519 keypair → deterministic Yggdrasil IPv6.
- **Discovery:** bootstrap to known peer IPs via TLS; mesh routing handles the rest.

For Stratum, AXL gives us three things:
1. Operator's MCP server is reachable from the subscriber **without** opening a port on the operator's box.
2. Both endpoints have stable IPv6-style identities derived from ed25519 keys — same identity model the agent system uses for signing.
3. The wire is e2e encrypted; we don't have to engineer TLS termination, ALPN, etc.

## 3. Topology for the demo

```
        ┌──────────────────────────────────────┐
        │          AXL bootstrap peer           │
        │       tls://bootstrap.gensyn.ai:9000  │
        │      (or our self-hosted bootstrap)   │
        └────────────────────┬──────────────────┘
                             │
                  ┌──────────┼──────────┐
                  │                     │
        ┌─────────▼────────┐   ┌────────▼─────────┐
        │   OPERATOR NODE   │   │  SUBSCRIBER NODE  │
        │   (laptop / VPS)  │   │   (laptop)        │
        │                   │   │                   │
        │  axl daemon       │   │  axl daemon       │
        │  ↓                │   │  ↓                │
        │  localhost:9001/  │   │  localhost:9002/  │
        │   ├── /send       │   │   ├── /send       │
        │   ├── /recv       │   │   ├── /recv       │
        │   ├── /mcp/       │   │   └── /a2a/       │
        │   └── /a2a/       │   │                   │
        │  ↓                │   │  ↓                │
        │  operator-svc     │   │  subscriber app   │
        │   (Node.js)       │   │   (Node.js or CLI)│
        └───────────────────┘   └───────────────────┘
```

Both nodes peer to a public bootstrap (no public ingress on either node). They discover each other through the mesh by Yggdrasil IPv6 address.

We also have **two demo-day machines minimum** — verifying the prize-qualification "across separate AXL nodes" without ambiguity. If we have three or four, even better, since we can show the mesh is real.

## 4. Operator node — AXL-related layout

```
operator/
├── axl/
│   ├── private.pem          # ed25519 key — the identity
│   ├── config.toml          # bootstrap peer, listen port, etc.
│   └── start.sh             # `axl --config config.toml`
├── mcp/
│   ├── server.ts            # MCP server impl
│   └── tools/
│       └── infer.ts         # exposes `agent.infer(tokenId, input)`
├── http/
│   ├── x402.ts              # paywall middleware
│   └── routes.ts
└── index.ts                 # entrypoint: starts MCP, x402, AXL bridge
```

`config.toml`:

```toml
[node]
private_key = "axl/private.pem"
listen      = "0.0.0.0:9100"

[bootstrap]
peers = ["tls://bootstrap.gensyn.ai:9000"]

[bridge]
http_addr = "127.0.0.1:9001"

[mcp]
enabled = true
upstream = "http://127.0.0.1:9050"   # our local MCP server

[a2a]
enabled = true
```

The operator's local MCP server listens on `127.0.0.1:9050`. AXL forwards any inbound `/mcp/*` mesh request to that local server. So from a subscriber's POV, "calling our MCP server" is just `POST <axl-bridge>/mcp/<operator-yggdrasil-ipv6>/<endpoint>` — AXL routes it.

## 5. MCP tools the operator exposes

```typescript
// mcp/tools/infer.ts
export const inferTool: McpTool = {
  name: "stratum.agent.infer",
  description: "Run inference on a sealed Stratum agent. Requires x402 payment.",
  inputSchema: {
    type: "object",
    properties: {
      tokenId: { type: "integer" },
      input: { type: "string" },
      paymentReceipt: { type: "string" }   // x402 receipt id
    },
    required: ["tokenId", "input", "paymentReceipt"]
  },
  outputSchema: {
    type: "object",
    properties: {
      output: { type: "string" },
      attestation: { type: "object" },
      receiptId: { type: "string" }
    }
  },
  handler: async (input, ctx) => {
    // 1. verify x402 payment via facilitator
    // 2. verify on-chain authorizeUsage
    // 3. open 0G Compute session
    // 4. run inference inside Sealed Executor
    // 5. write receipt to 0G Log
    // 6. return output + attestation
  }
};
```

Other tools we expose:
- `stratum.agent.profile(tokenId)` — returns the agent's metadata (no payment required).
- `stratum.agent.quote(tokenId)` — returns current price + payment instructions.
- `stratum.agent.attestation(receiptId)` — returns the attestation for a past receipt.
- `stratum.agent.list()` — returns all agents this operator runs.

Total MCP server: ~400 LoC TypeScript using `@modelcontextprotocol/sdk`.

## 6. Subscriber node — AXL-related layout

```
subscriber/
├── axl/
│   ├── private.pem
│   ├── config.toml
│   └── start.sh
├── client.ts                # MCP client + x402 + pay-with-any-token
└── ui.ts                    # CLI for demo
```

The subscriber's `client.ts` does:

```ts
import { McpClient } from "@modelcontextprotocol/sdk/client";
import { payWithAnyToken } from "@uniswap/pay-with-any-token";

const operatorYgg = "200:abcd:...";   // operator's Yggdrasil IPv6
const mcp = new McpClient({
  endpoint: `http://127.0.0.1:9002/mcp/${operatorYgg}`,
});

// 1. quote
const quote = await mcp.callTool("stratum.agent.quote", { tokenId: 42 });
// { perCall: 1_000_000n, asset: "USDC.base", recipient: "0xVAULT" }

// 2. pay
const result = await payWithAnyToken({
  payment: quote,
  fromToken: "PEPE.base",
  walletClient: subscriberWallet,
});

// 3. invoke
const out = await mcp.callTool("stratum.agent.infer", {
  tokenId: 42,
  input: solidityCode,
  paymentReceipt: result.receiptId,
});
```

The whole client is ~150 LoC. AXL routing and encryption are invisible to it — that's the "talks to localhost" abstraction.

## 7. Discovery

How does a subscriber know `operatorYgg`? Three layered options:

| Method | When |
|---|---|
| Read it from ENS text record `agent.endpoint` (we set it at mint) | Always works |
| Look up the agent's well-known JSON at `https://stratum.app/agent/AUDIT/.well-known/agent.json` | If operator publishes a `mcp.transport=axl` endpoint |
| Hard-coded for demo | Fallback |

We'll use **ENS-resolution** for the demo to make it land all the way: the subscriber's CLI looks up `auditor.stratum.eth` → reads `agent.endpoint` text record → reads the JSON → finds the AXL Yggdrasil address → routes through AXL. **End-to-end discovery via ENS+AXL with no centralized broker.**

This is the "uses AXL meaningfully" + "ENS doing real work" double-win.

## 8. Bootstrap peer

For the demo, we use Gensyn's public bootstrap if one exists, else self-host one on a $5 VPS:

```bash
# bootstrap node setup
mkdir -p axl-bootstrap && cd axl-bootstrap
cat >config.toml <<EOF
[node]
listen = "0.0.0.0:9000"
[bootstrap]
peers = []                    # no upstream; we are the upstream
EOF
axl --config config.toml &
```

Cost: free or $5/month. Risk: single point of failure for the demo, but we can ship a backup bootstrap address in our config.

## 9. Cross-node demo proof

To satisfy AXL prize "across separate nodes":
- Operator runs on **machine A** (e.g., team member 1's laptop, or a VPS).
- Subscriber runs on **machine B** (team member 2's laptop, or the demo machine itself).
- Both peer to bootstrap; mesh routes between them.
- During demo, we show:
  1. `axl --topology` on each machine — different peer IDs, both connected.
  2. `tcpdump` evidence (optional) showing no direct connection between A and B; all traffic is mesh-relayed and encrypted.
  3. Working inference call from B to A.

**Gotcha:** if the bootstrap is the only peer, traffic might still effectively be a hub-and-spoke. AXL judges may want true many-peer mesh. Mitigation: spin up a third node (a "watcher") that just sits on the mesh — proves the network is more than a pair.

## 10. Why AXL vs. alternatives

| Alternative | Why we'd lose the prize |
|---|---|
| libp2p direct | Generic, doesn't show "AXL meaningfully used" |
| HTTP + ngrok | Defeats the entire P2P thesis |
| WebRTC | No native MCP/A2A |
| Waku/XMTP | Message-oriented, not RPC |
| Tor hidden service | Possible but slower; AXL is purpose-built for agents |

The thesis we sell to Gensyn: **"AXL is the only stack where two AI agents on residential ISPs can call each other's MCP tools with no port-forwarding, no API key, no platform — and it's e2e encrypted by default."** Our demo shows exactly that.

## 11. Backup: in-process fallback (for the worst case)

If AXL bootstrap is down at demo time, we have a one-line config flip:

```toml
# config.toml
[mode]
fallback_loopback = true        # subscriber & operator both 127.0.0.1, same machine
```

This violates the "across separate nodes" requirement but lets the rest of the demo run. We'd lose the AXL prize but not the demo. We never want to reach this — but it's the safety net.

## 12. Implementation cost

| Piece | LoC | Person-hours |
|---|---|---|
| AXL daemon setup (config + scripts) | ~50 | 1h |
| Operator MCP server (with infer tool) | ~400 | 6h |
| Operator x402 gateway | ~200 | 3h |
| Subscriber CLI client | ~150 | 2h |
| Bootstrap node setup | ~30 | 1h |
| **Total** | ~830 | **~13h** |

One backend dev, one day. Doable.
