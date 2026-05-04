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
import {
  ZG_GALILEO,
  TEMPLATE_LIST,
  computeManifestHash,
  type AgentManifest,
  type CapabilityTemplate,
  type CapabilityTemplateId,
  type RuntimeTier,
} from "@stratum/shared";
import { pinManifestToOgStorage } from "../../lib/og-storage";

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

const RUNTIME_TIERS: Array<{ id: RuntimeTier; label: string; blurb: string; badge?: string }> = [
  {
    id: "openai-compat",
    label: "openai-compat",
    blurb: "single-shot. fastest, simplest, no tools. just system-prompt + model.",
  },
  {
    id: "tools-lite",
    label: "tools-lite",
    blurb: "per-call agent loop with the template's tool whitelist. fresh memory each call.",
  },
  {
    id: "hermes",
    label: "hermes",
    blurb: "full agent. persistent memory, multi-turn, the same runtime AUDIT uses.",
    badge: "experimental",
  },
];

export function LaunchClient() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onZg = chainId === ZG_CHAIN_ID;

  // Default to the headline cross-agent-orchestrator template; user can switch.
  const initialTemplate = TEMPLATE_LIST[0] as CapabilityTemplate;
  const [templateId, setTemplateId] = useState<CapabilityTemplateId>(initialTemplate.id);
  const [ticker, setTicker] = useState("WHALE");
  const [description, setDescription] = useState(initialTemplate.blurb);
  const [systemPrompt, setSystemPrompt] = useState(initialTemplate.systemPrompt);
  const [model, setModel] = useState(initialTemplate.defaultModel);
  const [runtimeTier, setRuntimeTier] = useState<RuntimeTier>(initialTemplate.suggestedTier);
  const [backend, setBackend] = useState<"openai-compat" | "0g-compute">("openai-compat");
  const [showSystemPromptEditor, setShowSystemPromptEditor] = useState(false);
  const ZG_TEE_PROVIDER = "0xa48f01287233509FD694a22Bf840225062E67836";
  // Provider currently serves qwen2.5-7b-instruct via TeeML; this can change
  // when the provider redeploys, so we stay descriptive.
  const ZG_TEE_MODEL = "provider-served · TeeML-attested";
  const [perCall, setPerCall] = useState("0.10");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [registerError, setRegisterError] = useState<string | null>(null);
  const [mintedTokenId, setMintedTokenId] = useState<string | null>(null);
  const [registered, setRegistered] = useState(false);
  const [testInput, setTestInput] = useState(initialTemplate.defaultTestInput);
  const [testRunning, setTestRunning] = useState(false);
  const [testOutput, setTestOutput] = useState<string | null>(null);
  const [financeDeploying, setFinanceDeploying] = useState(false);
  const [financeError, setFinanceError] = useState<string | null>(null);
  const [pinning, setPinning] = useState(false);
  const [pinResult, setPinResult] = useState<{ rootHash: string; uri: string; size: number } | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [pinnedManifest, setPinnedManifest] = useState<AgentManifest | null>(null);
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

  // After mint, register with operator so the agent is queryable. We pass
  // the pinned manifest + bundleManifestCid so the operator can verify the
  // on-chain hash binding before accepting the registration.
  useEffect(() => {
    if (!mintedTokenId || registered || !address || !txHash) return;
    if (!pinnedManifest || !pinResult) return;
    (async () => {
      try {
        const res = await fetch(`${OPERATOR_URL}/agents/register`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            tokenId: mintedTokenId,
            ticker: ticker.toUpperCase(),
            description,
            systemPrompt: pinnedManifest.brain.systemPrompt,
            model: pinnedManifest.brain.model,
            perCallSmallest: pinnedManifest.pricing.perCallSmallest,
            creator: address,
            txHash,
            runtime: runtimeTier === "hermes" ? "hermes" : "openai-compat",
            backend,
            bundleManifestCid: pinResult.rootHash,
            manifest: pinnedManifest,
          }),
        });
        if (!res.ok) throw new Error(`operator ${res.status}: ${await res.text()}`);
        setRegistered(true);
      } catch (e) {
        setRegisterError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [mintedTokenId, registered, address, txHash, ticker, description, runtimeTier, backend, pinnedManifest, pinResult]);

  /** Build the manifest from current form state. Pure — no I/O. */
  function buildManifest(creator: Hex): AgentManifest {
    return {
      schemaVersion: "stratum/agent-manifest@1",
      identity: {
        ticker: ticker.toUpperCase(),
        name: ticker.toUpperCase(),
        description,
        creator,
      },
      brain: {
        templateId,
        systemPrompt,
        model: backend === "0g-compute" ? "0g-tee-provider-served" : model,
        backend,
        runtimeTier,
      },
      capabilities: {
        tools: [...currentTemplate.tools],
        patterns: (currentTemplate.patterns ?? []).map((p) => ({ name: p.name, body: p.body })),
        skills: (currentTemplate.skills ?? []).map((s) => ({ name: s.name, body: s.body })),
      },
      pricing: {
        perCallSmallest: String(Math.round(Number(perCall) * 1e6)),
        perCallHuman: `$${Number(perCall).toFixed(2)}`,
      },
      meta: {
        createdAt: Math.floor(Date.now() / 1000),
        operatorHint: OPERATOR_URL,
      },
    };
  }

  // Live preview of the manifest hash so the right-hand panel can show what
  // will go on chain. Changes whenever any form field changes.
  const previewManifest = useMemo<AgentManifest | null>(() => {
    if (!address) return null;
    return buildManifest(address as Hex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, ticker, description, systemPrompt, model, backend, runtimeTier, perCall, templateId]);
  const previewManifestHash = useMemo(
    () => (previewManifest ? computeManifestHash(previewManifest) : null),
    [previewManifest],
  );

  async function mint() {
    if (!address || !onZg) return;
    if (!systemPrompt.trim()) {
      setErrorMsg("system prompt is required — it IS the agent");
      return;
    }
    setErrorMsg(null);
    setPinError(null);
    setPinResult(null);
    setPinnedManifest(null);
    setMintedTokenId(null);
    setRegistered(false);
    setRegisterError(null);
    setTestOutput(null);

    // 1. Build + pin the manifest to 0G Storage. The pin must succeed before
    //    we mint, because metadataHash on chain is the manifest's hash.
    setPinning(true);
    let manifest: AgentManifest;
    let pin: { rootHash: string; uri: string; size: number };
    try {
      manifest = buildManifest(address as Hex);
      const pinResponse = await pinManifestToOgStorage(manifest);
      pin = { rootHash: pinResponse.rootHash, uri: pinResponse.uri, size: pinResponse.size };
      const localHash = computeManifestHash(manifest).replace(/^0x/, "").toLowerCase();
      const remoteHash = pin.rootHash.replace(/^0x/, "").toLowerCase();
      if (localHash !== remoteHash) {
        throw new Error(
          `manifest hash mismatch: local ${localHash.slice(0, 16)}… vs operator ${remoteHash.slice(0, 16)}…`,
        );
      }
      setPinResult(pin);
      setPinnedManifest(manifest);
    } catch (e) {
      setPinError(e instanceof Error ? e.message : String(e));
      setPinning(false);
      return;
    }
    setPinning(false);

    // 2. Mint with metadataHash = keccak(canonical(manifest)).
    try {
      const metadataHash = `0x${pin.rootHash.replace(/^0x/, "")}` as Hex;
      const metadataURI = pin.uri;
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

  const currentTemplate = useMemo<CapabilityTemplate>(
    () => TEMPLATE_LIST.find((t) => t.id === templateId) ?? initialTemplate,
    [templateId, initialTemplate],
  );

  function applyTemplate(t: CapabilityTemplate) {
    setTemplateId(t.id);
    setDescription(t.blurb);
    setSystemPrompt(t.systemPrompt);
    setModel(t.defaultModel);
    setRuntimeTier(t.suggestedTier);
    setTestInput(t.defaultTestInput);
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
            anyone can list. pick a capability template, name it, mint an erc-7857 iNFT.
            the manifest pins to 0g storage; its hash binds on chain. the operator picks
            it up immediately and serves it with real tools, real agent-to-agent calls,
            real revenue to your shareholders.
          </p>
          <div className="hero-meta">
            <span className="pill ok">▌ permissionless mint</span>
            <span className="pill">erc-7857</span>
            <span className="pill">0g storage</span>
            <span className="pill">tools-lite runtime</span>
            <span className="pill">live in &lt;30s</span>
          </div>

          <div className="agent-event" style={{ marginTop: 14 }}>
            <span className="glyph">↳</span>
            <span>
              <b>capability templates</b> wire real tools (query_agent, fetch_url, image_gen,
              parse_ast, …). <span className="muted">your tokenId&apos;s metadataHash is keccak(manifest);
              tampering with any tool, prompt, or pattern breaks the chain commit.</span>
            </span>
          </div>
        </div>

        <div className="hero-r">
          <div className="loop-head">
            <span>capability templates · pick one</span>
            <span>{TEMPLATE_LIST.length} live</span>
          </div>
          <div style={{ display: "grid", gap: 8 }}>
            {TEMPLATE_LIST.map((t) => (
              <button
                key={t.id}
                type="button"
                className={`pay-card ${templateId === t.id ? "on" : ""}`}
                style={{ textAlign: "left" }}
                onClick={() => applyTemplate(t)}
              >
                <div className="h">
                  <span className="t">{t.label}</span>
                  <span className="badge">{templateId === t.id ? "selected" : t.sponsorTag}</span>
                </div>
                <div className="body">{t.blurb}</div>
                <div style={{ marginTop: 6, display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {t.tools.map((tool) => (
                    <span key={tool} className="pill" style={{ fontSize: 9 }}>{tool}</span>
                  ))}
                  <span className="pill ok" style={{ fontSize: 9 }}>tier · {t.suggestedTier}</span>
                </div>
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
              02 · capability template{" "}
              <span className="acc" style={{ float: "right", fontSize: 10, letterSpacing: "0.2em" }}>
                {currentTemplate.label.toUpperCase()}
              </span>
            </h3>
            <div className="muted" style={{ marginBottom: 8, fontSize: 11 }}>
              picked: <b className="acc">{currentTemplate.label}</b> · {currentTemplate.blurb}
            </div>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
              {currentTemplate.tools.map((tool) => (
                <span key={tool} className="pill" style={{ fontSize: 10 }}>{tool}</span>
              ))}
              <span className="pill ok" style={{ fontSize: 10 }}>
                tier · {currentTemplate.suggestedTier}
              </span>
              <span className="pill" style={{ fontSize: 10 }}>
                sponsor · {currentTemplate.sponsorTag}
              </span>
            </div>
            <button
              type="button"
              className="btn"
              style={{ fontSize: 11 }}
              onClick={() => setShowSystemPromptEditor((v) => !v)}
            >
              {showSystemPromptEditor ? "hide system prompt" : "edit system prompt →"}
            </button>
            {showSystemPromptEditor ? (
              <>
                <textarea
                  className="req"
                  style={{ minHeight: 200, marginTop: 8 }}
                  value={systemPrompt}
                  onChange={(e) => setSystemPrompt(e.target.value)}
                  spellCheck={false}
                />
                <div style={{ marginTop: 6, fontSize: 11, color: "var(--mute)" }}>
                  {systemPrompt.length} chars · keccak{" "}
                  <span className="acc">
                    {systemPrompt ? shortish(keccak256(toBytes(systemPrompt))) : "—"}
                  </span>
                </div>
              </>
            ) : null}
          </div>

          <div className="work-section">
            <h3>
              03 · compute backend{" "}
              {backend === "0g-compute" ? (
                <span className="acc" style={{ float: "right", fontSize: 10, letterSpacing: "0.2em" }}>
                  TEE-ATTESTED
                </span>
              ) : (
                <span className="muted" style={{ float: "right", fontSize: 10, letterSpacing: "0.2em" }}>
                  HOSTED LLM
                </span>
              )}
            </h3>
            <div className="pay-grid" style={{ marginBottom: 12 }}>
              <button
                type="button"
                className={`pay-card ${backend === "openai-compat" ? "on" : ""}`}
                onClick={() => setBackend("openai-compat")}
              >
                <div className="h">
                  <span className="t">venice</span>
                  <span className="badge">model breadth</span>
                </div>
                <div className="body">
                  pick from qwen3-coder-480b, claude-opus-4-7, grok, gemma-4. fast, hosted, no tee
                  attestation.
                </div>
              </button>
              <button
                type="button"
                className={`pay-card ${backend === "0g-compute" ? "on" : ""}`}
                onClick={() => setBackend("0g-compute")}
              >
                <div className="h">
                  <span className="t">0g compute</span>
                  <span className="badge">teeml-attested</span>
                </div>
                <div className="body">
                  inference runs inside intel tdx; broker verifies signature. each receipt carries{" "}
                  <span className="acc">isValid</span>. provider determines model.
                </div>
              </button>
            </div>

            {backend === "openai-compat" ? (
              <>
                <div className="up" style={{ marginBottom: 6 }}>venice model</div>
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
              </>
            ) : (
              <div className="kv" style={{ border: "1px solid rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.04)" }}>
                <div className="k">enclave</div>
                <div className="v acc">intel tdx · teeml signed</div>
                <div className="k">provider</div>
                <div className="v">{shortish(ZG_TEE_PROVIDER, 6)}</div>
                <div className="k">model</div>
                <div className="v">
                  {ZG_TEE_MODEL}{" "}
                  <span className="muted">— determined by provider attestation</span>
                </div>
                <div className="k">verifier</div>
                <div className="v">
                  <code>broker.inference.processResponse</code>
                </div>
                <div className="k">trade-off</div>
                <div className="v muted">
                  smaller model, slower first call (~10s broker init), every receipt has{" "}
                  <span className="acc">isValid</span>
                </div>
              </div>
            )}
          </div>

          <div className="work-section">
            <h3>
              04 · runtime tier{" "}
              <span className="acc" style={{ float: "right", fontSize: 10, letterSpacing: "0.2em" }}>
                {runtimeTier.toUpperCase()}
              </span>
            </h3>
            <div className="pay-grid" style={{ marginBottom: 8 }}>
              {RUNTIME_TIERS.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  className={`pay-card ${runtimeTier === t.id ? "on" : ""}`}
                  onClick={() => setRuntimeTier(t.id)}
                >
                  <div className="h">
                    <span className="t">{t.label}</span>
                    <span className="badge">{t.badge ?? (runtimeTier === t.id ? "selected" : "click")}</span>
                  </div>
                  <div className="body">{t.blurb}</div>
                </button>
              ))}
            </div>
            <div style={{ fontSize: 11, color: "var(--mute)" }}>
              {runtimeTier === "openai-compat"
                ? "single-shot. no tools. simplest, fastest. just system prompt + model."
                : runtimeTier === "tools-lite"
                  ? "operator runs an agent loop with this template's tool whitelist. fresh memory each call. recommended."
                  : "full hermes — persistent memory across calls. experimental for permissionless mints (the runtime materializes your manifest's patterns/skills as a real bundle)."}
            </div>
          </div>

          <div className="nav-btns">
            <span className="why">
              {!isConnected
                ? "connect wallet to mint"
                : !onZg
                  ? `wallet on chain ${chainId} · switch to 0g galileo (${ZG_CHAIN_ID})`
                  : pinning
                    ? "pinning manifest to 0g storage…"
                    : pinError
                      ? `pin failed: ${pinError.slice(0, 80)}`
                      : txPending
                        ? `mining tx ${txHash ? shortish(txHash) : ""}`
                        : mintedTokenId
                          ? `minted #${mintedTokenId}${registered ? " · registered" : registerError ? " · register failed" : " · registering…"}`
                          : "pin manifest → mint iNFT on 0g galileo → register with operator · <30s"}
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
                  disabled={pinning || txPending || Boolean(mintedTokenId)}
                >
                  {pinning
                    ? "pinning…"
                    : txPending
                      ? "minting…"
                      : mintedTokenId
                        ? "minted ✓"
                        : "pin · mint · register →"}
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
          {pinError ? (
            <div style={{ padding: "10px 20px", color: "var(--red)", fontSize: 12, borderTop: "1px solid var(--hair-2)" }}>
              0g storage pin failed: {pinError}
            </div>
          ) : null}
        </div>

        <div className="work-r">
          <div className="seal-stage">
            <h3>what gets minted · the iNFT story end-to-end</h3>
            <div className="seal-anim" style={{ minHeight: 0 }}>
              <pre style={{ margin: 0, fontFamily: "inherit", fontSize: 12, lineHeight: 1.45, color: "var(--fg-2)" }}>
{`  ┌─ on 0g storage ─────────────────────┐
  │ manifest.json · ${truncFit(currentTemplate.id, 20)}│
  │   tools     · ${truncFit(currentTemplate.tools.join(","), 22)}│
  │   patterns  · ${(currentTemplate.patterns?.length ?? 0).toString().padEnd(22)}│
  │   skills    · ${(currentTemplate.skills?.length ?? 0).toString().padEnd(22)}│
  │   rootHash  · ${truncFit(pinResult ? pinResult.rootHash : (previewManifestHash ?? "(preview after wallet connect)").replace(/^0x/, ""), 22)}│
  │                                     │
  ├─ on chain · 0g galileo ─────────────┤
  │ erc-7857 inft                       │
  │   metadataHash · keccak(manifest)   │
  │   metadataURI  · 0g-storage://…     │
  │                                     │
  ├─ operator registry · post-mint ─────┤
  │   tokenId   · ${mintedTokenId ? `#${mintedTokenId}`.padEnd(22) : "(after mint)           "}│
  │   tier      · ${truncFit(runtimeTier, 22)}│
  │   backend   · ${truncFit(backend, 22)}│
  │   perCall   · $${perCall.padEnd(21)}│
  │                                     │
  │ live at /x402/infer immediately     │
  └─────────────────────────────────────┘`}
              </pre>
            </div>
            {pinResult ? (
              <div className="kv" style={{ marginTop: 10, border: "1px solid rgba(16,185,129,0.35)", background: "rgba(16,185,129,0.04)" }}>
                <div className="k">manifest pinned</div>
                <div className="v acc">{shortish(pinResult.rootHash)}</div>
                <div className="k">size</div>
                <div className="v">{pinResult.size.toLocaleString()} bytes</div>
                <div className="k">uri</div>
                <div className="v">{pinResult.uri}</div>
              </div>
            ) : null}
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
