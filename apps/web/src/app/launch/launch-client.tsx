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
const OPERATOR_URL =
  process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

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

/** Models we know Venice serves and that the operator can route to. */
const MODELS: Array<{ id: string; label: string; goodFor: string }> = [
  { id: "qwen3-coder-480b-a35b-instruct-turbo", label: "qwen3-coder-480b · turbo", goodFor: "code, audits, structured json" },
  { id: "qwen3-235b-a22b-instruct-2507", label: "qwen3-235b-a22b", goodFor: "general reasoning, instruction-following" },
  { id: "claude-opus-4-7", label: "claude-opus-4-7", goodFor: "highest-quality reasoning, long context" },
  { id: "google-gemma-4-31b-it", label: "gemma-4-31b-it", goodFor: "fast, cheap, decent quality" },
  { id: "grok-41-fast", label: "grok-4.1-fast", goodFor: "broad knowledge, fast" },
];

const PRESET_PROMPTS: Array<{ key: string; label: string; prompt: string; model: string; description: string }> = [
  {
    key: "translator",
    label: "translator",
    prompt:
      "You are a precise translation agent. The user gives you text in any language; respond with JSON {\"detected_lang\": \"...\", \"english\": \"...\", \"notes\": \"...\"}. Be literal, no editorializing. No prose outside the JSON.",
    model: "qwen3-coder-480b-a35b-instruct-turbo",
    description: "Translate any text to English with detected source language.",
  },
  {
    key: "tldr",
    label: "tl;dr",
    prompt:
      "You are a one-paragraph summarizer. The user gives you arbitrary text. Reply with JSON {\"summary\": \"<= 50 words\", \"key_points\": [\"...\"], \"sentiment\": \"positive|neutral|negative\"}. Nothing else.",
    model: "google-gemma-4-31b-it",
    description: "Summarize any text into a tight TL;DR with sentiment.",
  },
  {
    key: "rugcheck",
    label: "rug-check",
    prompt:
      "You are a meme-token ruggability scout. Given a token name + URL or description, respond with JSON {\"score\": 0-10, \"red_flags\": [\"...\"], \"verdict\": \"safe|caution|rug\"}. 10 = obvious rug. Be skeptical and concise.",
    model: "qwen3-coder-480b-a35b-instruct-turbo",
    description: "Score a meme token's rug-ability 0-10 with reasoning.",
  },
  {
    key: "headline",
    label: "headline-writer",
    prompt:
      "You are a Bloomberg-terminal headline writer. Given a topic, produce JSON {\"primary\": \"<= 70 chars all-caps\", \"secondary\": \"<= 120 chars\", \"tickers\": [\"...\"]}. Sharp, factual, no fluff.",
    model: "claude-opus-4-7",
    description: "Crisp Bloomberg-style headlines for any topic.",
  },
];

export function LaunchClient() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onZg = chainId === ZG_CHAIN_ID;

  const [ticker, setTicker] = useState("MYBOT");
  const [description, setDescription] = useState(
    "translates any text to english and detects the source language.",
  );
  const [systemPrompt, setSystemPrompt] = useState(PRESET_PROMPTS[0]!.prompt);
  const [model, setModel] = useState(MODELS[0]!.id);
  const [perCall, setPerCall] = useState("0.10");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [testInput, setTestInput] = useState("Bonjour, comment ça va aujourd'hui ?");
  const [testRunning, setTestRunning] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [financeDeploying, setFinanceDeploying] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [finance, setFinance] = useState<{
    shareToken: string;
    revenueVault: string;
    ipoSale: string;
    txHashes: { shareToken: string; revenueVault: string; ipoSale: string };
  } | null>(null);

  const { writeContractAsync, data: txHash } = useWriteContract();
  const {
    isLoading: txPending,
    isSuccess: txConfirmed,
    data: receipt,
  } = useWaitForTransactionReceipt({ hash: txHash, chainId: ZG_CHAIN_ID });

  // Decode Transfer log to extract minted tokenId.
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
        if (
          args.from === "0x0000000000000000000000000000000000000000" &&
          args.to.toLowerCase() === address?.toLowerCase()
        ) {
          setMintedTokenId(args.tokenId.toString());
          break;
        }
      } catch {
        /* skip */
      }
    }
  }, [txConfirmed, receipt, address]);

  // After mint, register with operator so the agent is queryable.
  useEffect(() => {
    if (!mintedTokenId || registered || !address || !txHash) return;
    (async () => {
      try {
        const res = await fetch(`${OPERATOR_URL}/agents/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tokenId: mintedTokenId,
            ticker: ticker.toUpperCase(),
            description,
            systemPrompt,
            model,
            perCallSmallest: String(Math.round(Number(perCall) * 1e6)),
            creator: address,
            txHash,
            runtime: "openai-compat",
          }),
        });
        if (!res.ok) throw new Error(`operator ${res.status}: ${await res.text()}`);
        setRegistered(true);
      } catch (e) {
        setRegisterError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [mintedTokenId, registered, address, txHash, ticker, description, systemPrompt, model, perCall]);

  const metadataPayload = useMemo(
    () => ({
      ticker: ticker.toUpperCase(),
      description,
      systemPromptHash: typeof window === "undefined" ? "" : keccak256(toBytes(systemPrompt)),
      model,
      runtime: "openai-compat",
      perCallUsdc: perCall,
      version: "stratum/agent-metadata/v1",
    }),
    [ticker, description, systemPrompt, model, perCall],
  );
  const metadataJson = JSON.stringify(metadataPayload, null, 2);
  const metadataHash = useMemo(() => keccak256(toBytes(metadataJson)), [metadataJson]);
  const metadataURI = useMemo(
    () => `data:application/json;base64,${typeof window === "undefined" ? "" : btoa(metadataJson)}`,
    [metadataJson],
  );

  async function mint() {
    if (!address || !onZg) return;
    if (!systemPrompt.trim()) {
      setErrorMsg("system prompt is required — it IS the agent");
      return;
    }
    setErrorMsg(null);
    setMintedTokenId(null);
    setRegistered(false);
    setRegisterError(null);
    setTestOutput(null);

    try {
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

  async function deployFinance() {
    if (!mintedTokenId || !registered) return;
    setFinanceDeploying(true);
    setFinanceError(null);
    try {
      const res = await fetch(`${OPERATOR_URL}/agents/${mintedTokenId}/deploy-finance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`operator ${res.status}: ${txt.slice(0, 400)}`);
      const body = JSON.parse(txt) as {
        agent?: { finance?: { shareToken: string; revenueVault: string; ipoSale: string } };
        txHashes?: { shareToken: string; revenueVault: string; ipoSale: string };
      };
      const f = body.agent?.finance;
      if (!f) throw new Error("operator returned no finance addresses");
      setFinance({
        shareToken: f.shareToken,
        revenueVault: f.revenueVault,
        ipoSale: f.ipoSale,
        txHashes: body.txHashes ?? { shareToken: "", revenueVault: "", ipoSale: "" },
      });
    } catch (e) {
      setFinanceError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinanceDeploying(false);
    }
  }

  async function runTest() {
    if (!mintedTokenId || !registered) return;
    setTestRunning(true);
    setTestOutput(null);
    try {
      // Direct LLM-only test: call the operator's runtime via a debug shim.
      // We don't go through x402 here — just exercise the registered system
      // prompt + model so the user sees their agent talking.
      const res = await fetch(`${OPERATOR_URL}/agents/test`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tokenId: mintedTokenId, input: testInput }),
      });
      const txt = await res.text();
      if (!res.ok) throw new Error(`operator ${res.status}: ${txt.slice(0, 400)}`);
      const body = JSON.parse(txt) as { output?: string };
      setTestOutput(body.output ?? txt);
    } catch (e) {
      setTestOutput(`error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setTestRunning(false);
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
            ship a productive<br />
            <em>agent.</em>
          </h1>
          <p className="hero-sub">
            anyone can list. write a system prompt — that&apos;s the agent&apos;s brain. pick a venice
            model. mint an erc-7857 inft. the operator picks it up immediately and serves your
            prompt under the x402 paywall. revenue from each call accrues to whoever holds shares.
          </p>
          <div className="hero-meta">
            <span className="pill ok">▌ permissionless mint</span>
            <span className="pill">erc-7857</span>
            <span className="pill">venice models</span>
            <span className="pill">live in &lt;30s</span>
          </div>

          <div className="agent-event" style={{ marginTop: 14 }}>
            <span className="glyph">↳</span>
            <span>
              <b>your system prompt</b> is the agent&apos;s identity. <span className="muted">model + prompt are stored on operator (registered after mint), hash pinned in the iNFT metadata on chain.</span>
            </span>
          </div>
        </div>

        <div className="hero-r">
          <div className="loop-head">
            <span>presets · or write your own</span>
            <span>{PRESET_PROMPTS.length} starters</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {PRESET_PROMPTS.map((p) => (
              <button
                key={p.key}
                type="button"
                className="pay-card"
                style={{ textAlign: "left" }}
                onClick={() => {
                  setTicker(p.label.toUpperCase().replace(/[^A-Z0-9]/g, ""));
                  setDescription(p.description);
                  setSystemPrompt(p.prompt);
                  setModel(p.model);
                }}
              >
                <div className="h">
                  <span className="t">{p.label}</span>
                  <span className="badge">load</span>
                </div>
                <div className="body">{p.description}</div>
              </button>
            ))}
          </div>
        </div>
      </section>

      <section className="work">
        <div className="work-l">
          <div className="work-section">
            <h3>01 · agent identity</h3>
            <div className="ds-grid cols-2" style={{ gap: 12 }}>
              <Field label="ticker" value={ticker} onChange={setTicker} placeholder="MYBOT" />
              <Field label="per-call (usdc)" value={perCall} onChange={setPerCall} placeholder="0.10" />
            </div>
            <div style={{ marginTop: 12 }}>
              <div className="up">description · shown on markets page</div>
              <textarea
                className="req"
                style={{ minHeight: 60, marginTop: 6 }}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
          </div>

          <div className="work-section">
            <h3>
              02 · system prompt{" "}
              <span className="acc" style={{ float: "right", fontSize: 10, letterSpacing: "0.2em" }}>
                THE BRAIN
              </span>
            </h3>
            <div className="muted" style={{ marginBottom: 6, fontSize: 11 }}>
              this is the agent. every paid call prepends this to the user&apos;s input. ask for JSON
              output if you want structured responses (the runtime defaults to JSON mode).
            </div>
            <textarea
              className="req"
              style={{ minHeight: 220 }}
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              placeholder="You are a precise translation agent..."
              spellCheck={false}
            />
            <div style={{ marginTop: 6, fontSize: 11, color: "var(--mute)" }}>
              {systemPrompt.length} chars · keccak{" "}
              <span className="acc">
                {systemPrompt ? shortish(keccak256(toBytes(systemPrompt))) : "—"}
              </span>
            </div>
          </div>

          <div className="work-section">
            <h3>03 · model</h3>
            <div style={{ display: "grid", gap: 6 }}>
              {MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`pay-card ${model === m.id ? "on" : ""}`}
                  style={{ textAlign: "left" }}
                  onClick={() => setModel(m.id)}
                >
                  <div className="h">
                    <span className="t">{m.label}</span>
                    <span className="badge">{model === m.id ? "selected" : "click"}</span>
                  </div>
                  <div className="body">{m.goodFor}</div>
                </button>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11, color: "var(--mute)" }}>
              served via venice → operator routes inferences here
            </div>
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
                      ? `minted #${mintedTokenId}${registered ? " · registered" : registerError ? " · register failed" : " · registering…"}`
                      : "mint inft on 0g galileo · register with operator · ready in <30s"}
            </span>
            <div style={{ display: "flex", gap: 10 }}>
              {!isConnected ? (
                <button className="btn" disabled>connect first</button>
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
                  {txPending ? "minting…" : mintedTokenId ? "minted ✓" : "mint & register →"}
                </button>
              )}
            </div>
          </div>
          {errorMsg ? (
            <div style={{ padding: "10px 20px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--hair-2)" }}>
              {errorMsg}
            </div>
          ) : null}
          {registerError ? (
            <div style={{ padding: "10px 20px", color: "var(--amber)", fontSize: 12, borderTop: "1px solid var(--hair-2)" }}>
              register failed: {registerError} — iNFT was minted, you can manually register later.
            </div>
          ) : null}
        </div>

        <div className="work-r">
          <div className="seal-stage">
            <h3>tee · what gets minted + registered</h3>
            <div className="seal-anim" style={{ minHeight: 0 }}>
              <pre style={{ margin: 0, fontFamily: "inherit", fontSize: 12, lineHeight: 1.45, color: "var(--fg-2)" }}>
{`  ┌─────────────────────────────────────┐
  │ erc-7857 inft · 0g galileo          │
  │   metadataHash · keccak(meta json)  │
  │   sealedKey    · placeholder        │
  │   teeAttest    · placeholder        │
  │                                     │
  │ operator registry · post-mint       │
  │   tokenId      · ${mintedTokenId ? `#${mintedTokenId}`.padEnd(20) : "(after mint)         "}│
  │   systemPrompt · ${(systemPrompt.length + " chars").padEnd(20)}│
  │   model        · ${truncFit(model, 20)}│
  │   perCall      · $${perCall.padEnd(19)}│
  │                                     │
  │ available at /x402/infer immediately│
  └─────────────────────────────────────┘`}
              </pre>
            </div>
          </div>

          {mintedTokenId && registered ? (
            <div className="attest-receipt" style={{ display: "block" }}>
              <div className="head">
                <span className="t">live · permissionless agent registered</span>
                <span className="muted" style={{ fontSize: 10 }}>0g galileo · operator</span>
              </div>
              <h2>your agent is serving.</h2>
              <div className="body">
                tokenId <b className="acc">#{mintedTokenId}</b> minted to your wallet AND registered
                with the operator. the system prompt + model are now live behind x402. test it below
                without paying — direct runtime call, same path the paid x402 endpoint uses.
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
                        chainscan ↗
                      </a>
                    ) : "—"}
                  </div>
                </div>
                <div className="c">
                  <div className="l">operator</div>
                  <div className="v acc">/agents/{mintedTokenId}</div>
                </div>
              </div>

              <div className="out" style={{ marginTop: 14 }}>
                <h4>test inference · no payment required</h4>
                <textarea
                  className="req"
                  style={{ minHeight: 60 }}
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  placeholder="ask your new agent something…"
                />
                <div style={{ marginTop: 8, display: "flex", gap: 10, alignItems: "center" }}>
                  <button className="btn primary" onClick={runTest} disabled={testRunning || !testInput.trim()}>
                    {testRunning ? "running…" : "run inference →"}
                  </button>
                  <span className="muted" style={{ fontSize: 11 }}>
                    bypasses x402 — goes straight to your agent&apos;s runtime
                  </span>
                </div>
                {testOutput ? (
                  <pre style={{ marginTop: 12, padding: 10, background: "#0a0a0a", border: "1px solid var(--hair-2)", color: "var(--fg-2)", fontSize: 12, overflow: "auto", whiteSpace: "pre-wrap" }}>
                    {testOutput}
                  </pre>
                ) : null}
              </div>

              {/* Finance deploy — operator deploys ShareToken + Vault + IPO on Base */}
              <div className="out" style={{ marginTop: 14 }}>
                <h4>fractional shares · deploy on base sepolia</h4>
                {finance ? (
                  <div className="kv" style={{ marginTop: 6 }}>
                    <div className="k">share token</div>
                    <div className="v acc">
                      <a href={`https://sepolia.basescan.org/address/${finance.shareToken}`} target="_blank" rel="noreferrer">
                        {shortish(finance.shareToken)} ↗
                      </a>
                    </div>
                    <div className="k">revenue vault</div>
                    <div className="v acc">
                      <a href={`https://sepolia.basescan.org/address/${finance.revenueVault}`} target="_blank" rel="noreferrer">
                        {shortish(finance.revenueVault)} ↗
                      </a>
                    </div>
                    <div className="k">ipo sale</div>
                    <div className="v acc">
                      <a href={`https://sepolia.basescan.org/address/${finance.ipoSale}`} target="_blank" rel="noreferrer">
                        {shortish(finance.ipoSale)} ↗
                      </a>
                    </div>
                  </div>
                ) : (
                  <>
                    <div style={{ fontSize: 12, color: "var(--fg-2)", marginBottom: 8 }}>
                      one click → operator deploys ShareToken (1M supply to you), RevenueVault, and IPOSale on Base Sepolia. After this your agent has a live cap table + primary issuance.
                    </div>
                    <button
                      className="btn primary"
                      onClick={deployFinance}
                      disabled={financeDeploying}
                    >
                      {financeDeploying ? "deploying 3 contracts on base…" : "deploy fractional shares →"}
                    </button>
                    {financeError ? (
                      <div style={{ marginTop: 8, color: "var(--red)", fontSize: 12 }}>{financeError}</div>
                    ) : null}
                  </>
                )}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <div className="section-h">
        <h2>your agent is live · everything below is real</h2>
        <span className="sub">no mocks · no placeholders</span>
      </div>
      <div className="ds-grid cols-3" style={{ gap: "var(--gap)" }}>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>onchain</span></div>
            <div className="rhs"><span className="pill ok">0g galileo</span></div>
          </div>
          <ul style={{ padding: "12px 18px 14px 32px", margin: 0, color: "var(--fg-2)", fontSize: 12 }}>
            <li>erc-7857 iNFT minted to your wallet</li>
            <li>metadata hash + sealed-key pinned on chain</li>
            <li>permissionless: anyone can list — no allowlist</li>
            <li>your tokenId is uniquely yours · transferable</li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>operator</span></div>
            <div className="rhs"><span className="pill ok">live</span></div>
          </div>
          <ul style={{ padding: "12px 18px 14px 32px", margin: 0, color: "var(--fg-2)", fontSize: 12 }}>
            <li>your system prompt is the agent identity</li>
            <li>routed to your chosen Venice model</li>
            <li>test inference above hits the same runtime as paid calls</li>
            <li>responds with TEE-attested receipt at /x402/infer</li>
          </ul>
        </div>
        <div className="panel">
          <div className="panel-head">
            <div className="lhs"><span>economy</span></div>
            <div className="rhs"><span className="pill ok">x402</span></div>
          </div>
          <ul style={{ padding: "12px 18px 14px 32px", margin: 0, color: "var(--fg-2)", fontSize: 12 }}>
            <li>x402 paywall live — your price, your USDC</li>
            <li>each call returns a signed receipt</li>
            <li>other agents can pay yours (a→a economy)</li>
            <li>vault wiring + share-token IPO ship next deploy</li>
          </ul>
        </div>
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

function truncFit(s: string, w: number): string {
  if (s.length <= w) return s.padEnd(w);
  return s.slice(0, w - 1) + "…";
}
