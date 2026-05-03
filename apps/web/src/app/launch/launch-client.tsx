"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { decodeEventLog, keccak256, toBytes, stringToHex } from "viem";
import { ZG_GALILEO } from "@stratum/shared";

type Hex = `0x${string}`;

const ZG_CHAIN_ID = ZG_GALILEO.chainId;
const AGENT_NFT_ADDRESS = ZG_GALILEO.agentNft;

// Inline mint ABI + Transfer event (the existing stratumAgentNftAbi doesn't expose mint).
const mintAbi = [
  {
    type: "function",
    name: "mint",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "metadataHash", type: "bytes32" },
      { name: "metadataURI", type: "string" },
      { name: "sealedKey", type: "bytes" },
      { name: "teeAttestation", type: "bytes" },
    ],
    outputs: [{ type: "uint256" }],
  },
  {
    type: "event",
    name: "Transfer",
    inputs: [
      { name: "from", type: "address", indexed: true },
      { name: "to", type: "address", indexed: true },
      { name: "tokenId", type: "uint256", indexed: true },
    ],
  },
] as const;

const RUNTIME_OPTIONS = [
  { value: "hermes", label: "hermes-pattern · skills + memory + tool loop" },
  { value: "openai-compat", label: "raw · single-shot llm" },
];

export function LaunchClient() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onZg = chainId === ZG_CHAIN_ID;

  const [ticker, setTicker] = useState("MYBOT");
  const [name, setName] = useState("my new agent");
  const [ens, setEns] = useState("mybot.stratum.eth");
  const [description, setDescription] = useState(
    "a productive on-chain agent. shareholders earn revenue from each call.",
  );
  const [model, setModel] = useState("qwen3-coder-480b · venice");
  const [runtime, setRuntime] = useState("hermes");
  const [perCall, setPerCall] = useState("0.50");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null);

  const { writeContractAsync, data: txHash } = useWriteContract();
  const {
    isLoading: txPending,
    isSuccess: txConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({
    hash: txHash,
    chainId: ZG_CHAIN_ID,
  });

  // Decode the Transfer log to extract the freshly-minted tokenId.
  useEffect(() => {
    if (!txConfirmed || !receipt) return;
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== AGENT_NFT_ADDRESS.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: mintAbi,
          eventName: "Transfer",
          topics: log.topics,
          data: log.data,
        });
        const args = decoded.args as { from: Hex; to: Hex; tokenId: bigint };
        if (args.from === "0x0000000000000000000000000000000000000000" && args.to.toLowerCase() === address?.toLowerCase()) {
          setMintedTokenId(args.tokenId.toString());
          break;
        }
      } catch {
        // skip non-Transfer logs
      }
    }
  }, [txConfirmed, receipt, address]);

  const metadataPayload = useMemo(
    () => ({
      ticker: ticker.toUpperCase(),
      name,
      ens,
      description,
      model,
      runtime,
      perCallUsdc: perCall,
      version: "stratum/agent-metadata/v1",
    }),
    [ticker, name, ens, description, model, runtime, perCall],
  );
  const metadataJson = JSON.stringify(metadataPayload, null, 2);
  const metadataHash = useMemo(() => keccak256(toBytes(metadataJson)), [metadataJson]);
  const metadataURI = useMemo(
    () => `data:application/json;base64,${typeof window === "undefined" ? "" : btoa(metadataJson)}`,
    [metadataJson],
  );

  async function mint() {
    if (!address || !onZg) return;
    setErrorMsg(null);
    setMintedTokenId(null);

    try {
      // Placeholder sealed key + tee attestation (testnet; real ERC-7857 fork
      // parses TDX/SGX quotes). The contract keccaks the attestation bytes
      // and stores that as the expected measurement.
      const sealedKey = stringToHex(`sealed:${ticker}:${Date.now()}`);
      const teeAttestation = stringToHex(`tee-attestation:${ticker}:${Date.now()}`);

      await writeContractAsync({
        address: AGENT_NFT_ADDRESS,
        abi: mintAbi,
        functionName: "mint",
        args: [address, metadataHash, metadataURI, sealedKey, teeAttestation],
        chainId: ZG_CHAIN_ID,
      });
    } catch (e) {
      setErrorMsg(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <>
      <div className="crumb">
        <Link href="/">markets</Link> <span className="muted">/</span>{" "}
        <span className="acc">launch agent</span>
        <span style={{ float: "right", color: "var(--mute-2)" }}>
          permissionless · 0g-galileo · agent nft <span className="fg2">{shortish(AGENT_NFT_ADDRESS)}</span>
        </span>
      </div>

      <section className="hero" data-screen-label="launch">
        <div className="hero-l">
          <div className="hero-tag">▌ slopstock · launch</div>
          <h1 className="hero-h1">
            mint a productive<br />
            <em>agent.</em>
          </h1>
          <p className="hero-sub">
            anyone can list an agent. mint an erc-7857 inft on 0g galileo, pin its sealed bundle, and
            you&apos;re live in the registry. fractionalization, vault, and ipo are configured against this
            tokenId. the operator picks up new agents from the on-chain registry.
          </p>
          <div className="hero-meta">
            <span className="pill ok">▌ permissionless mint</span>
            <span className="pill">erc-7857</span>
            <span className="pill">0g galileo</span>
            <span className="pill">tee-sealed bundle</span>
          </div>
        </div>

        <div className="hero-r">
          <div className="loop-head">
            <span>listing pipeline</span>
            <span>4 stages</span>
          </div>
          <div className="loop">
            <pre className="ascii" dangerouslySetInnerHTML={{ __html: PIPELINE_ASCII }} />
          </div>
        </div>
      </section>

      <section className="work">
        <div className="work-l">
          <div className="work-section">
            <h3>01 · agent identity</h3>
            <div className="ds-grid cols-2" style={{ gap: 12 }}>
              <Field label="ticker" value={ticker} onChange={setTicker} placeholder="MYBOT" />
              <Field label="ens name" value={ens} onChange={setEns} placeholder="mybot.stratum.eth" />
              <Field label="display name" value={name} onChange={setName} placeholder="my new agent" />
              <Field label="per-call (usdc)" value={perCall} onChange={setPerCall} placeholder="0.50" />
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="up">description</div>
              <textarea
                className="req"
                style={{ minHeight: 80, marginTop: 6 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="work-section">
            <h3>02 · runtime + model</h3>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {RUNTIME_OPTIONS.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={`pay-card ${runtime === o.value ? "on" : ""}`}
                  style={{ flex: "1 1 280px", textAlign: "left" }}
                  onClick={() => setRuntime(o.value)}
                >
                  <div className="h">
                    <span className="t">{o.value}</span>
                    <span className="badge">{o.value === "hermes" ? "stateful" : "single-shot"}</span>
                  </div>
                  <div className="body">{o.label}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 12 }}>
              <Field label="model bundle" value={model} onChange={setModel} placeholder="qwen3-coder-480b · venice" />
            </div>
          </div>

          <div className="work-section">
            <h3>03 · sealed metadata preview</h3>
            <div className="kv" style={{ marginTop: 4 }}>
              <div className="k">metadata hash</div>
              <div className="v acc">{shortish(metadataHash)}</div>
              <div className="k">metadata uri</div>
              <div className="v">data:application/json;base64,…</div>
              <div className="k">sealed key</div>
              <div className="v muted">[generated at mint · placeholder testnet]</div>
              <div className="k">tee attestation</div>
              <div className="v muted">[generated at mint · placeholder testnet]</div>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="up" style={{ cursor: "pointer" }}>raw metadata json</summary>
              <pre style={{ marginTop: 8, fontSize: 11, color: "var(--fg-2)", background: "#0a0a0a", padding: 10, border: "1px solid var(--hair-2)", overflow: "auto" }}>
                {metadataJson}
              </pre>
            </details>
          </div>

          <div className="nav-btns">
            <span className="why">
              {!isConnected
                ? "connect wallet to mint"
                : !onZg
                  ? `wallet on chain ${chainId} · switch to 0g galileo (${ZG_CHAIN_ID})`
                  : txPending
                    ? `mining tx ${txHash ? shortish(txHash) : ""}`
                    : mintedTokenId
                      ? `minted tokenId #${mintedTokenId}`
                      : "minting calls StratumAgentNFT.mint() — you pay 0G gas, receive an iNFT"}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              {!isConnected ? (
                <button className="btn" disabled>connect wallet first</button>
              ) : !onZg ? (
                <button className="btn" onClick={() => switchChain({ chainId: ZG_CHAIN_ID })}>
                  switch to 0g galileo
                </button>
              ) : (
                <button
                  className="btn primary"
                  onClick={mint}
                  disabled={txPending || Boolean(mintedTokenId)}
                >
                  {txPending ? "minting…" : mintedTokenId ? "minted ✓" : "mint inft →"}
                </button>
              )}
            </div>
          </div>
          {errorMsg ? (
            <div style={{ padding: "10px 20px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--hair-2)" }}>
              {errorMsg}
            </div>
          ) : null}
        </div>

        <div className="work-r">
          <div className="seal-stage">
            <h3>tee · what gets minted</h3>
            <div className="seal-anim" style={{ minHeight: 0 }}>
              <pre style={{ margin: 0, fontFamily: "inherit", fontSize: 12, lineHeight: 1.45, color: "var(--fg-2)" }}>
{`  ┌─────────────────────────────────────┐
  │ erc-7857 inft · permissionless mint │
  │                                     │
  │   to               · your wallet    │
  │   metadataHash     · keccak(meta)   │
  │   metadataURI      · data: uri      │
  │   sealedKey        · tee-bound      │
  │   teeAttestation   · tdx quote      │
  │                                     │
  │ contract derives:                   │
  │   tokenId          · ++_nextId      │
  │   measurement      · keccak(att.)   │
  │   ownerOf          · = to           │
  └─────────────────────────────────────┘`}
              </pre>
            </div>
          </div>

          {mintedTokenId ? (
            <div className="attest-receipt" style={{ display: "block" }}>
              <div className="head">
                <span className="t">minted · onchain</span>
                <span className="muted" style={{ fontSize: 10 }}>0g galileo</span>
              </div>
              <h2>your agent is live.</h2>
              <div className="body">
                tokenId <b className="acc">#{mintedTokenId}</b> minted to your wallet. the iNFT is now in
                your possession. revenue and shares are not yet wired — see next steps below.
              </div>
              <div className="grid">
                <div className="c">
                  <div className="l">tokenId</div>
                  <div className="v acc">#{mintedTokenId}</div>
                </div>
                <div className="c">
                  <div className="l">tx hash</div>
                  <div className="v">{txHash ? shortish(txHash) : "—"}</div>
                </div>
                <div className="c">
                  <div className="l">explorer</div>
                  <div className="v">
                    {txHash ? (
                      <a className="acc" href={`https://chainscan-galileo.0g.ai/tx/${txHash}`} target="_blank" rel="noreferrer">
                        chainscan-galileo ↗
                      </a>
                    ) : "—"}
                  </div>
                </div>
                <div className="c">
                  <div className="l">contract</div>
                  <div className="v">{shortish(AGENT_NFT_ADDRESS)}</div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </section>

      {/* WHAT'S STILL NEEDED — honest scope panel */}
      <div className="section-h">
        <h2>next steps · full listing</h2>
        <span className="sub">what you minted vs. what AUDIT/MEMER/ORCL have today</span>
      </div>
      <div className="ds-grid cols-2" style={{ gap: "var(--gap)" }}>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>what just happened</span><span className="tag muted">browser-only</span></div>
            <div className="rhs"><span className="pill ok">live</span></div>
          </div>
          <ul style={{ padding: "12px 18px 14px 32px", margin: 0, color: "var(--fg-2)", fontSize: 12 }}>
            <li>iNFT minted on 0G Galileo (you own tokenId)</li>
            <li>metadata hash + sealed-key placeholder pinned on chain</li>
            <li>measurement derived from teeAttestation bytes (keccak)</li>
            <li>ENS name embedded in metadata (ENSIP-25 registration is a separate tx)</li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>what still requires the deployer</span><span className="tag muted">scripted</span></div>
            <div className="rhs"><span className="pill warn">deferred</span></div>
          </div>
          <ul style={{ padding: "12px 18px 14px 32px", margin: 0, color: "var(--fg-2)", fontSize: 12 }}>
            <li>ShareToken (ERC-20) deploy on Base Sepolia</li>
            <li>RevenueVault deploy + bind to vault address</li>
            <li>IPOSale deploy with allocation + price-per-share</li>
            <li>operator config: add tokenId to RUNTIME_BY_TOKEN_ID + system prompt</li>
            <li>setApprovalForAll(operator, true) so authorizeUsage works on subscribe</li>
          </ul>
        </div>
      </div>

      <div className="notes">
        <h3>design notes · launch flow</h3>
        <ul>
          <li><b>permissionless by contract.</b> StratumAgentNFT.mint() has no access control on testnet — the protocol is genuinely open. Anyone with 0G gas can list.</li>
          <li><b>browser is honest.</b> The mint button does what it says — one transaction, one iNFT. The page does not pretend to deploy ShareToken/Vault/IPO; those are explicitly listed as deferred (deployer-scripted today, automated post-hackathon).</li>
          <li><b>identity panel mirrors the markets row.</b> Ticker, ENS, description, runtime — same fields a judge sees on the markets page. The mental model is &quot;fill the row, get the row.&quot;</li>
          <li><b>metadata is sealed bundle, not free-form.</b> JSON shape matches AGENT_METADATA in lib — keccak determines the on-chain hash. Real ERC-7857 fork swaps the placeholder attestation for a parsed TDX/SGX quote.</li>
          <li><b>next-steps panel is part of the design</b>, not an afterthought. Every prototype lies about what&apos;s real; we surface the gap explicitly. That&apos;s the same energy as the &quot;deferred&quot; list in the README.</li>
        </ul>
      </div>
    </>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label style={{ display: "block" }}>
      <div className="up">{label}</div>
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        style={{
          marginTop: 6,
          width: "100%",
          background: "#0a0a0a",
          border: "1px solid var(--hair)",
          color: "var(--fg)",
          padding: "10px 12px",
          fontFamily: "inherit",
          fontSize: 13,
          borderRadius: 2,
          outline: "none",
        }}
      />
    </label>
  );
}

function shortish(s: string, chars = 8): string {
  if (!s.startsWith("0x")) return s;
  return `${s.slice(0, 2 + chars)}…${s.slice(-chars)}`;
}

const PIPELINE_ASCII = `   ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
   │  <span class="acc">mint</span>    │ ▶  │  shares  │ ▶  │   ipo    │ ▶  │ operator │
   │  inft    │    │  erc-20  │    │   sale   │    │  config  │
   └──────────┘    └──────────┘    └──────────┘    └──────────┘
        <span class="acc">▲ you do this here</span>           <span class="mu">▲ deferred / scripted</span>

   <span class="mu">erc-7857 ─── erc-20 ────── primary issuance ─── live</span>`;
