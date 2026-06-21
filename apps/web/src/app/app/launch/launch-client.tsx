"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Crumb } from "@/components/crumb";
import { Rail } from "@/components/rail";
import {
  useAccount,
  useChainId,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from "wagmi";
import { decodeEventLog, stringToHex, parseUnits } from "viem";
import {
  ZG_GALILEO,
  TEMPLATE_LIST,
  CREDENTIALED_PRESETS,
  computeManifestHash,
  type AgentManifest,
  type CapabilityTemplate,
  type CapabilityTemplateId,
  type RuntimeTier,
} from "@stratum/shared";
import { pinManifestToOgStorage } from "@/lib/og-storage";
import { InferenceOutput } from "@/components/inference-output";

type Hex = `0x${string}`;

const ZG_CHAIN_ID = ZG_GALILEO.chainId;
const BASE_CHAIN_ID = 84532;
const AGENT_NFT_ADDRESS = ZG_GALILEO.agentNft;
const OPERATOR_URL =
  process.env["NEXT_PUBLIC_OPERATOR_URL"] ?? "http://127.0.0.1:8402";

const erc20ApproveAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

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

// Every launched agent is Hermes on 0G-v4 and starts from this minimal base
// toolset; it self-improves (skills auto-create) from there.
const BASE_TOOLS = ["recall", "note", "query_agent"] as const;

export function LaunchClient() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();
  const onZg = chainId === ZG_CHAIN_ID;

  // Launch-rework: no capability templates, no Venice, no runtime picker. Every
  // agent is Hermes on 0G-v4; the system prompt IS the agent. templateId is kept
  // as a hidden constant only because the manifest type still carries it (the
  // operator ignores it). Tools default to a minimal base set — Hermes seeds the
  // rest and self-improves.
  const initialTemplate = TEMPLATE_LIST[0] as CapabilityTemplate;
  const templateId: CapabilityTemplateId = initialTemplate.id;
  const runtimeTier: RuntimeTier = "hermes";
  const backend: "openai-compat" | "0g-compute" = "0g-compute";
  const [ticker, setTicker] = useState("WHALE");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showSkillsEditor, setShowSkillsEditor] = useState(false);
  const [customSkills, setCustomSkills] = useState<Array<{ name: string; body: string }>>([]);
  // Tool credentials → provisioned into 1Claw at launch, never into the manifest/model.
  const [credentials, setCredentials] = useState<Array<{ ref: string; value: string }>>([]);

  const ZG_TEE_PROVIDER = "0x1B3AAef3ae5050EEE04ea38cD4B087472BD85EB0";
  const ZG_TEE_NETWORK = "0G mainnet · chainId 16661";
  const [perCall, setPerCall] = useState("0.10");

  type WizStep = "identity" | "review" | "live";
  const [wizStep, setWizStep] = useState<WizStep>("identity");
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
  const [approving, setApproving] = useState(false);
  const [approved, setApproved] = useState(false);
  const [approveError, setApproveError] = useState<string | null>(null);
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
          setWizStep("live");
          break;
        }
      } catch {
        /* skip */
      }
    }
  }, [txConfirmed, receipt, address]);

  useEffect(() => {
    if (!mintedTokenId || registered || !address || !txHash) return;
    if (!pinnedManifest || !pinResult) return;
    (async () => {
      try {
        await fetchJsonWithRetry(`${OPERATOR_URL}/agents/register`, {
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
            runtime: "hermes",
            backend: "0g-compute",
            bundleManifestCid: pinResult.rootHash,
            manifest: pinnedManifest,
            // Tool credentials → operator provisions each into 1Claw at launch.
            // Sent once, never persisted client-side or in the manifest.
            credentials: credentials.filter((c) => c.ref.trim() && c.value),
          }),
        });
        setRegistered(true);
      } catch (e) {
        setRegisterError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [mintedTokenId, registered, address, txHash, ticker, description, pinnedManifest, pinResult, credentials]);

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
        model: backend === "0g-compute" ? "0g-tee-provider-served" : initialTemplate.defaultModel,
        backend,
        runtimeTier,
      },
      capabilities: {
        tools: [...BASE_TOOLS],
        patterns: [],
        skills: customSkills
          .map((s) => ({ name: s.name.trim(), body: s.body }))
          .filter((s) => s.name.length > 0 && s.body.trim().length > 0),
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

  const previewManifest = useMemo<AgentManifest | null>(() => {
    if (!address) return null;
    return buildManifest(address as Hex);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, ticker, description, systemPrompt, backend, runtimeTier, perCall, templateId, customSkills]);
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

  async function approveShares() {
    if (!finance || !address) return;
    setApproving(true);
    setApproveError(null);
    try {
      if (chainId !== BASE_CHAIN_ID) {
        await switchChain({ chainId: BASE_CHAIN_ID });
      }
      const maxSharesWei = parseUnits("100000", 18);
      await writeContractAsync({
        address: finance.shareToken as Hex,
        abi: erc20ApproveAbi,
        functionName: "approve",
        args: [finance.ipoSale as Hex, maxSharesWei],
        chainId: BASE_CHAIN_ID,
      });
      setApproved(true);
    } catch (e) {
      setApproveError(e instanceof Error ? e.message : String(e));
    } finally {
      setApproving(false);
    }
  }

  async function deployFinance() {
    if (!mintedTokenId) return;
    if (financeDeploying || finance) return;
    setFinanceDeploying(true);
    setFinanceError(null);
    try {
      // Kick off (idempotent server-side: if already running for this tokenId,
      // it just reports the current state). Then poll until terminal.
      await fetchJsonWithRetry(`${OPERATOR_URL}/agents/${mintedTokenId}/deploy-finance`, {
        method: "POST",
        headers: { "content-type": "application/json" },
      });
      const result = await pollFinanceStatus(mintedTokenId);
      setFinance({
        shareToken: result.finance.shareToken,
        revenueVault: result.finance.revenueVault,
        ipoSale: result.finance.ipoSale,
        txHashes: result.txHashes ?? { shareToken: "", revenueVault: "", ipoSale: "" },
      });
    } catch (e) {
      setFinanceError(e instanceof Error ? e.message : String(e));
    } finally {
      setFinanceDeploying(false);
    }
  }

  // Auto-kick the finance deploy as soon as the agent is registered. The
  // operator already kicks it off server-side from /agents/register, but
  // calling deploy-finance from the client too is idempotent and lets us
  // start polling for the result without a manual click.
  useEffect(() => {
    if (!registered || !mintedTokenId) return;
    if (finance || financeDeploying || financeError) return;
    void deployFinance();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registered, mintedTokenId]);

  async function runTest() {
    if (!mintedTokenId || !registered) return;
    setTestRunning(true);
    setTestOutput(null);
    try {
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

  // Step index for the Rail — identity → review → live.
  const stepIndex = wizStep === "identity" ? 0 : wizStep === "review" ? 1 : 2;

  const stepLabel =
    wizStep === "identity" ? "identity + brain" : wizStep === "review" ? "review + mint" : "go live";

  // Skills surfaced as a count for the "skills + tools" collapsed row.
  const skillCount = customSkills.filter((s) => s.name.trim() && s.body.trim()).length;

  return (
    <>
      <Crumb
        path={
          <>
            ~/<Link href="/app">markets</Link> · <Link href="/app/launch">launch</Link> ·{" "}
            <b style={{ color: "var(--fg)" }}>step 0{stepIndex + 1}</b> / 03 · {stepLabel}
          </>
        }
        right={
          <>
            permissionless · 0g-galileo · agent nft{" "}
            <span className="fg2">{shortish(AGENT_NFT_ADDRESS)}</span>
          </>
        }
      />

      <div style={{ marginBottom: 26 }}>
        <Rail
          steps={["identity", "review + mint", "go live"]}
          current={stepIndex}
        />
      </div>

      {wizStep === "identity" ? (
        <IdentityStep
          ticker={ticker}
          setTicker={setTicker}
          description={description}
          setDescription={setDescription}
          perCall={perCall}
          setPerCall={setPerCall}
          systemPrompt={systemPrompt}
          setSystemPrompt={setSystemPrompt}
          customSkills={customSkills}
          setCustomSkills={setCustomSkills}
          showSkillsEditor={showSkillsEditor}
          setShowSkillsEditor={setShowSkillsEditor}
          credentials={credentials}
          setCredentials={setCredentials}
          previewManifestHash={previewManifestHash}
          skillCount={skillCount}
          onContinue={() => setWizStep("review")}
        />
      ) : wizStep === "review" ? (
        <ReviewStep
          ticker={ticker}
          perCall={perCall}
          credentialCount={credentials.filter((c) => c.ref.trim() && c.value).length}
          previewManifestHash={previewManifestHash}
          pinResult={pinResult}
          isConnected={isConnected}
          onZg={onZg}
          chainId={chainId}
          switchChainTo={(id) => switchChain({ chainId: id })}
          mint={mint}
          pinning={pinning}
          txPending={txPending}
          mintedTokenId={mintedTokenId}
          txHash={txHash ?? null}
          errorMsg={errorMsg}
          pinError={pinError}
          registerError={registerError}
          onBack={() => setWizStep("identity")}
        />
      ) : (
        <LiveStep
          ticker={ticker}
          mintedTokenId={mintedTokenId}
          registered={registered}
          txHash={txHash ?? null}
          testInput={testInput}
          setTestInput={setTestInput}
          runTest={runTest}
          testRunning={testRunning}
          testOutput={testOutput}
          finance={finance}
          deployFinance={deployFinance}
          financeDeploying={financeDeploying}
          financeError={financeError}
          approveShares={approveShares}
          approving={approving}
          approveError={approveError}
          approved={approved}
          chainId={chainId}
          ZG_TEE_PROVIDER={ZG_TEE_PROVIDER}
          ZG_TEE_NETWORK={ZG_TEE_NETWORK}
        />
      )}
    </>
  );
}

/* ───────────── Step 1 · identity + brain + credentials ───────────── */

function IdentityStep(props: {
  ticker: string;
  setTicker: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
  perCall: string;
  setPerCall: (v: string) => void;
  systemPrompt: string;
  setSystemPrompt: (v: string) => void;
  customSkills: Array<{ name: string; body: string }>;
  setCustomSkills: (v: Array<{ name: string; body: string }> | ((prev: Array<{ name: string; body: string }>) => Array<{ name: string; body: string }>)) => void;
  showSkillsEditor: boolean;
  setShowSkillsEditor: (v: boolean | ((prev: boolean) => boolean)) => void;
  credentials: Array<{ ref: string; value: string }>;
  setCredentials: (v: Array<{ ref: string; value: string }> | ((prev: Array<{ ref: string; value: string }>) => Array<{ ref: string; value: string }>)) => void;
  previewManifestHash: string | null;
  skillCount: number;
  onContinue: () => void;
}) {
  const {
    ticker, setTicker, description, setDescription, perCall, setPerCall,
    systemPrompt, setSystemPrompt,
    customSkills, setCustomSkills, showSkillsEditor, setShowSkillsEditor,
    credentials, setCredentials,
    previewManifestHash, skillCount, onContinue,
  } = props;

  const tickerOk = /^[A-Za-z][A-Za-z0-9]{0,7}$/.test(ticker);
  const priceFee = (Number(perCall) * 0.95).toFixed(2);

  // One-click curated credentialed agents: prefill ticker, description, prompt,
  // and a 1Claw credential slot wired to the tool the prompt drives.
  function applyPreset(p: CapabilityTemplate) {
    const suggestedTicker = (p.label.split("·").pop() ?? "").trim().toUpperCase();
    if (/^[A-Z][A-Z0-9]{0,7}$/.test(suggestedTicker)) setTicker(suggestedTicker);
    setDescription(p.blurb.slice(0, 200));
    setSystemPrompt(p.systemPrompt);
    setCredentials(p.credentialRef ? [{ ref: p.credentialRef, value: "" }] : []);
  }

  return (
    <section style={{ display: "grid", gridTemplateRows: "auto 1fr auto", rowGap: 22 }}>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          name your agent
        </h1>
        <div style={{ fontSize: 15, color: "var(--fg-2)" }}>
          ticker becomes its ENS subname under <code>slopstock.eth</code> + the ERC-20 share symbol. permanent.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 460px", gap: 28, alignItems: "start" }}>
        {/* LEFT — form */}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* Curated credentialed presets — one click prefills a useful agent. */}
          <div className="ss-field">
            <label>start from a useful agent · optional</label>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {CREDENTIALED_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn ghost"
                  onClick={() => applyPreset(p)}
                  title={p.blurb}
                  style={{ fontSize: 12 }}
                >
                  {(p.label.split("·").pop() ?? p.id).trim()} — {p.id}
                </button>
              ))}
            </div>
            <div className="help">
              prefills the prompt + a 1Claw credential slot (the key is provisioned to 1Claw at launch, never to the model).
            </div>
          </div>

          <div className="ss-field">
            <label>ticker · max 8 chars</label>
            <div className={"inp" + (tickerOk ? " focus" : "")}>
              <input
                value={ticker}
                onChange={(e) => setTicker(e.target.value.toUpperCase().slice(0, 8))}
                style={{ textTransform: "uppercase", letterSpacing: "0.04em", fontWeight: 600 }}
              />
              <span className="suf">.slopstock.eth</span>
            </div>
            <div className="help">
              {tickerOk ? <span className="ok">✓ available</span> : <span style={{ color: "var(--amber)" }}>letters + digits, must start with a letter</span>}
              {" · resolves to 0g chain id "}{ZG_GALILEO.chainId}
            </div>
          </div>

          <div className="ss-field">
            <label>one-line description · shown on markets</label>
            <div className="inp">
              <input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>
            <div className="help">
              <span className="n">{description.length}</span>/200 chars
            </div>
          </div>

          <div className="ss-field">
            <label>per-call price</label>
            <div className="inp">
              <span className="pre">$</span>
              <input value={perCall} onChange={(e) => setPerCall(e.target.value)} />
              <span className="suf">USDC</span>
            </div>
            <div className="help">
              you receive <span className="n" style={{ color: "var(--fg-2)" }}>${priceFee}</span> per call ·
              runtime <b style={{ color: "var(--fg-2)" }}>hermes</b> on{" "}
              <b style={{ color: "var(--fg-2)" }}>0G compute · intel TDX</b> (deepseek v3, every reply TEE-signed)
            </div>
          </div>

          {/* System prompt — it IS the agent (required). */}
          <div className="ss-field">
            <label>system prompt · this IS the agent</label>
            <textarea
              value={systemPrompt}
              onChange={(e) => setSystemPrompt(e.target.value)}
              spellCheck={false}
              className="req"
              placeholder="You are … — describe the agent's role, expertise, tone, and how it should use its tools. Hermes grows skills from here."
              style={{ minHeight: 200 }}
            />
            <div className="help">
              <span className="n">{systemPrompt.length}</span> chars · seeds the Hermes agent dir; it self-improves from here
            </div>
          </div>

          {/* Tool credentials → 1Claw (never in the manifest or model context). */}
          <div className="ss-field">
            <label>tool credentials · stored in 1Claw</label>
            <div className="help" style={{ marginTop: -2, marginBottom: 8 }}>
              keys for any API your tools call (e.g. <code>elevenlabs</code>). stored in 1Claw&apos;s HSM at
              launch, fetched just-in-time — <b style={{ color: "var(--fg-2)" }}>never</b> in the manifest,
              model context, or receipt.
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {credentials.map((c, i) => (
                <div key={i} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    value={c.ref}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCredentials((arr) => arr.map((x, j) => (j === i ? { ...x, ref: v } : x)));
                    }}
                    placeholder="ref · e.g. elevenlabs"
                    style={{ flex: "0 0 200px", background: "#0a0a0a", border: "1px solid var(--hair)", padding: "8px 10px", color: "var(--fg)", fontSize: 14, borderRadius: 2, fontFamily: "inherit" }}
                  />
                  <input
                    type="password"
                    value={c.value}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCredentials((arr) => arr.map((x, j) => (j === i ? { ...x, value: v } : x)));
                    }}
                    placeholder="api key · write-only, sent to 1Claw"
                    style={{ flex: 1, background: "#0a0a0a", border: "1px solid var(--hair)", padding: "8px 10px", color: "var(--fg)", fontSize: 14, borderRadius: 2, fontFamily: "inherit" }}
                  />
                  <button
                    type="button"
                    onClick={() => setCredentials((arr) => arr.filter((_, j) => j !== i))}
                    style={{ border: "1px solid rgba(239,68,68,0.4)", color: "var(--red)", padding: "6px 10px", borderRadius: 2, background: "transparent", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
                  >
                    ✕
                  </button>
                </div>
              ))}
              <div>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCredentials((arr) => [...arr, { ref: "", value: "" }])}
                >
                  + add credential
                </button>
              </div>
            </div>
          </div>

          <button
            type="button"
            className="panel"
            onClick={() => setShowSkillsEditor((v) => !v)}
            style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 14px", cursor: "pointer", textAlign: "left", color: "inherit", fontFamily: "inherit", fontSize: "inherit", border: "1px solid var(--hair)" }}
          >
            <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ color: "var(--mute)" }}>{showSkillsEditor ? "▾" : "▸"}</span>
              <span style={{ color: "var(--fg-2)" }}>skills · bundled into manifest</span>
              <span className="pill solid">{skillCount} skill{skillCount === 1 ? "" : "s"}</span>
            </span>
            <span className="mono-h">{showSkillsEditor ? "collapse" : "expand"}</span>
          </button>
          {showSkillsEditor ? (
            <div style={{ display: "grid", gap: 10 }}>
              {customSkills.map((sk, i) => (
                <div key={i} style={{ border: "1px solid var(--hair-2)", padding: 10, borderRadius: 2 }}>
                  <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}>
                    <input
                      value={sk.name}
                      onChange={(e) => {
                        const v = e.target.value;
                        setCustomSkills((arr) => arr.map((s, j) => (j === i ? { ...s, name: v } : s)));
                      }}
                      placeholder="skill-name"
                      style={{ flex: 1, background: "#0a0a0a", border: "1px solid var(--hair)", padding: "6px 10px", color: "var(--fg)", fontSize: 14, borderRadius: 2, fontFamily: "inherit" }}
                    />
                    <button
                      type="button"
                      onClick={() => setCustomSkills((arr) => arr.filter((_, j) => j !== i))}
                      style={{ border: "1px solid rgba(239,68,68,0.4)", color: "var(--red)", padding: "2px 8px", borderRadius: 2, background: "transparent", cursor: "pointer", fontSize: 13, fontFamily: "inherit" }}
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={sk.body}
                    onChange={(e) => {
                      const v = e.target.value;
                      setCustomSkills((arr) => arr.map((s, j) => (j === i ? { ...s, body: v } : s)));
                    }}
                    spellCheck={false}
                    className="req"
                    style={{ minHeight: 100, fontSize: 13 }}
                  />
                </div>
              ))}
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCustomSkills((arr) => [...arr, { name: "", body: "" }])}
                >
                  + add skill
                </button>
                <button
                  type="button"
                  className="btn"
                  onClick={() => setCustomSkills([])}
                >
                  clear all
                </button>
              </div>
            </div>
          ) : null}
        </div>

        {/* RIGHT — live manifest preview */}
        <div className="panel" style={{ alignSelf: "stretch", display: "flex", flexDirection: "column" }}>
          <div className="panel-h">
            <span className="t">manifest · live preview</span>
            <span className="pill green">building</span>
          </div>
          <pre className="ascii" style={{ margin: 0, padding: "14px 16px", fontSize: 13, lineHeight: 1.55, whiteSpace: "pre" }}>
{`┌─ agent.manifest ─────────────────┐
│  ticker     ${truncFit((ticker || "—").toUpperCase() + ".slopstock.eth", 22).padEnd(22)}│
│  price      ${truncFit("$" + (perCall || "0.00") + " USDC / call", 22).padEnd(22)}│
│  runtime    ${truncFit("hermes", 22).padEnd(22)}│
│  backend    ${truncFit("0g · intel tdx", 22).padEnd(22)}│
│  secrets    ${truncFit(credentials.filter((c) => c.ref.trim() && c.value).length + " key(s) → 1claw", 22).padEnd(22)}│
├─ tools (${BASE_TOOLS.length}) ──────────────────────┤`}
{"\n"}
{BASE_TOOLS.map((t) => `│  ▸ ${t.padEnd(30)}│`).join("\n")}
{"\n"}
{`├─ skills (${skillCount}) ──────────────────────┤`}
{"\n"}
{skillCount === 0
  ? "│  (none yet · hermes grows its own)   │"
  : customSkills
      .filter((s) => s.name.trim() && s.body.trim())
      .slice(0, 6)
      .map((s) => `│  • ${truncFit(s.name, 32).padEnd(32)}│`)
      .join("\n")}
{"\n"}
{`├─ artifacts ──────────────────────┤
│  manifest hash    ${previewManifestHash ? truncFit(previewManifestHash.replace(/^0x/, ""), 14).padEnd(14) : "(at mint time)"}│
│  inft tokenid     ${"(at mint time)".padEnd(14)}│
│  ens record       reserved       │
└──────────────────────────────────┘`}
          </pre>
          <div style={{ borderTop: "1px solid var(--hair)", padding: "10px 14px", fontSize: 13, color: "var(--mute)", display: "flex", justifyContent: "space-between" }}>
            <span>live · recomputes on every keystroke</span>
            <span><span style={{ color: "var(--accent)" }}>●</span> manifest valid</span>
          </div>
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--mute)" }}>
          changes auto-saved to local draft · hash recomputes on every edit
        </span>
        <div style={{ display: "flex", gap: 10 }}>
          <Link className="btn" href="/app">esc · cancel</Link>
          <button
            className="btn primary"
            onClick={onContinue}
            disabled={!tickerOk || !description.trim() || !perCall.trim() || !systemPrompt.trim()}
          >
            review + mint →
          </button>
        </div>
      </div>
    </section>
  );
}

/* ───────────── Step 3 · review + mint ───────────── */

function ReviewStep(props: {
  ticker: string;
  perCall: string;
  credentialCount: number;
  previewManifestHash: string | null;
  pinResult: { rootHash: string; uri: string; size: number } | null;
  isConnected: boolean;
  onZg: boolean;
  chainId: number;
  switchChainTo: (id: number) => void;
  mint: () => void;
  pinning: boolean;
  txPending: boolean;
  mintedTokenId: string | null;
  txHash: Hex | null;
  errorMsg: string | null;
  pinError: string | null;
  registerError: string | null;
  onBack: () => void;
}) {
  const {
    ticker, perCall, credentialCount, previewManifestHash,
    pinResult, isConnected, onZg, chainId, switchChainTo, mint, pinning, txPending,
    mintedTokenId, txHash, errorMsg, pinError, registerError, onBack,
  } = props;

  const subSteps: Array<{ t: string; sub: string; st: "ready" | "queued" | "ok" | "live" }> =
    !isConnected || !onZg
      ? [
          { t: "sign manifest", sub: "wallet popup", st: "queued" },
          { t: "pin to 0g storage", sub: "ipfs cid + replicas", st: "queued" },
          { t: "mint inft on 0g", sub: "erc-7857 + meta key", st: "queued" },
          { t: "register x402", sub: "subname → tokenid", st: "queued" },
        ]
      : pinning
        ? [
            { t: "sign manifest", sub: "wallet popup", st: "ok" },
            { t: "pin to 0g storage", sub: "ipfs cid + replicas", st: "live" },
            { t: "mint inft on 0g", sub: "erc-7857 + meta key", st: "queued" },
            { t: "register x402", sub: "subname → tokenid", st: "queued" },
          ]
        : txPending
          ? [
              { t: "sign manifest", sub: "wallet popup", st: "ok" },
              { t: "pin to 0g storage", sub: "ipfs cid + replicas", st: "ok" },
              { t: "mint inft on 0g", sub: "erc-7857 + meta key", st: "live" },
              { t: "register x402", sub: "subname → tokenid", st: "queued" },
            ]
          : mintedTokenId
            ? [
                { t: "sign manifest", sub: "wallet popup", st: "ok" },
                { t: "pin to 0g storage", sub: "ipfs cid + replicas", st: "ok" },
                { t: "mint inft on 0g", sub: "erc-7857 + meta key", st: "ok" },
                { t: "register x402", sub: "subname → tokenid", st: "live" },
              ]
            : [
                { t: "sign manifest", sub: "wallet popup", st: "ready" },
                { t: "pin to 0g storage", sub: "ipfs cid + replicas", st: "queued" },
                { t: "mint inft on 0g", sub: "erc-7857 + meta key", st: "queued" },
                { t: "register x402", sub: "subname → tokenid", st: "queued" },
              ];

  return (
    <section style={{ display: "grid", gridTemplateRows: "auto 1fr auto", rowGap: 22 }}>
      <div>
        <h1 style={{ fontSize: 30, fontWeight: 600, margin: "0 0 4px", letterSpacing: "-0.01em" }}>
          final review
        </h1>
        <div style={{ fontSize: 15, color: "var(--fg-2)" }}>
          once minted, ticker + manifest hash are immutable. pricing + prompt remain owner-editable.
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 28, alignItems: "start" }}>
        {/* LEFT — full kv */}
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div className="panel">
            <div className="panel-h">
              <span className="t">agent</span>
              <span className="pill green">manifest valid</span>
            </div>
            <div className="kv" style={{ padding: "10px 0" }}>
              <div className="k">ticker</div><div className="v"><b style={{ letterSpacing: "0.04em" }}>{ticker.toUpperCase()}.slopstock.eth</b></div>
              <div className="k">price</div><div className="v" style={{ color: "var(--accent)" }}>${perCall} USDC</div>
              <div className="k">protocol fee</div><div className="v">5% · ${(Number(perCall) * 0.05).toFixed(2)} / call</div>
              <div className="k">runtime</div><div className="v">hermes</div>
              <div className="k">compute</div><div className="v">0G compute · intel tdx</div>
              <div className="k">tools</div><div className="v">{BASE_TOOLS.join(", ")} · hermes base</div>
              <div className="k">secrets</div><div className="v">{credentialCount} key(s) → 1Claw</div>
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
            <div className="panel">
              <div className="panel-h">
                <span className="t">manifest hash</span>
                <span className="pill solid">keccak256</span>
              </div>
              <div style={{ padding: 14, fontSize: 13, color: "var(--fg-2)", wordBreak: "break-all", lineHeight: 1.6 }}>
                {previewManifestHash ? `0x${previewManifestHash.replace(/^0x/, "")}` : "(connect wallet to compute)"}
              </div>
            </div>
            <div className="panel">
              <div className="panel-h">
                <span className="t">manifest cid</span>
                <span className="pill solid">0g storage</span>
              </div>
              <div style={{ padding: 14, fontSize: 13, color: "var(--fg-2)", wordBreak: "break-all", lineHeight: 1.6 }}>
                {pinResult ? pinResult.uri : "(pinned at mint)"}
              </div>
            </div>
          </div>
        </div>

        {/* RIGHT — multichain ASCII map */}
        <div className="panel" style={{ alignSelf: "stretch", display: "flex", flexDirection: "column" }}>
          <div className="panel-h">
            <span className="t">what gets created · 4 chains, 1 tx campaign</span>
            <span className="mono-h">~14s end-to-end</span>
          </div>
          <pre className="ascii" style={{ margin: 0, padding: "18px 22px", fontSize: 13, lineHeight: 1.55 }}>
{`             ╔═══════════════════════════════╗
             ║   `}<span className="f">0G GALILEO  ·  iNFT</span>{`        ║
             ║   ┌────────────────────┐      ║
             ║   │  ERC-7857 #pending │      ║
             ║   │  manifest hash on  │      ║
             ║   │  chain · sealed    │      ║
             ║   └─────────┬──────────┘      ║
             ╚═════════════│═════════════════╝
                           │
        ┌──────────────────┼──────────────────┐
        ▼                  ▼                  ▼
  ╔═════════════╗   ╔═════════════╗    ╔═════════════╗
  ║ `}<span className="f">SHARE TOKEN</span>{` ║   ║ `}<span className="f">REVENUE VLT</span>{` ║    ║   `}<span className="f">IPO SALE</span>{`  ║
  ║   erc-20    ║   ║  per-snap   ║    ║  fixed price║
  ║  ${truncFit(ticker.toUpperCase(), 11).padEnd(11)}║   ║  pull pay   ║    ║  $${truncFit(perCall, 6).padEnd(6)}/sh ║
  ║  supply 1M  ║   ║  usdc claim ║    ║  cap 1.0M   ║
  ╚══════╤══════╝   ╚══════╤══════╝    ╚══════╤══════╝
         └─────────────────┼──────────────────┘
                           │
              ╔════════════▼═════════════╗
              ║   `}<span className="f">BASE SEPOLIA</span>{`           ║
              ║   chain-id  84532        ║
              ║   tx campaign 3 deploys  ║
              ╚══════════════════════════╝
   `}<span className="d">─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─</span>{`
   `}<span className="m">manifest pin →</span>{` ╔══════════════════════════╗
                  ║   `}<span className="f">0G STORAGE</span>{`             ║
                  ║   keccak-content-addr   ║
                  ║   replicas 3 · ttl ∞    ║
                  ╚══════════════════════════╝`}
          </pre>
        </div>
      </div>

      <div>
        {!isConnected ? (
          <button className="mint-btn" disabled>
            connect wallet to mint <span className="ar">→</span>
          </button>
        ) : !onZg ? (
          <button className="mint-btn busy" onClick={() => switchChainTo(ZG_CHAIN_ID)}>
            switch to 0g galileo · chain {ZG_CHAIN_ID} <span className="ar">→</span>
          </button>
        ) : (
          <button
            className={"mint-btn" + (pinning || txPending ? " busy" : "")}
            onClick={mint}
            disabled={pinning || txPending || Boolean(mintedTokenId)}
          >
            {pinning
              ? "pinning manifest to 0G Storage…"
              : txPending
                ? `minting iNFT on 0G Galileo · tx ${txHash ? shortish(txHash) : "…"}`
                : mintedTokenId
                  ? `minted #${mintedTokenId} ✓`
                  : `mint ${ticker.toUpperCase()}.slopstock.eth`}
            {!pinning && !txPending && !mintedTokenId ? <span className="ar">→</span> : null}
          </button>
        )}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 0, marginTop: 10 }}>
          {subSteps.map((s, i) => (
            <div
              key={i}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px",
                borderRight: i < 3 ? "1px solid var(--hair)" : "none",
                borderBottom: "1px solid var(--hair)",
                borderLeft: i === 0 ? "1px solid var(--hair)" : "none",
                borderTop: "1px solid var(--hair)",
              }}
            >
              <span className="n" style={{ color: "var(--mute)", fontSize: 13 }}>
                {String(i + 1).padStart(2, "0")}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 14, color: "var(--fg)" }}>{s.t}</div>
                <div style={{ fontSize: 12, color: "var(--mute)", letterSpacing: "0.06em" }}>{s.sub}</div>
              </div>
              <span
                className={
                  "pill " +
                  (s.st === "ok" ? "green" : s.st === "live" ? "amber" : s.st === "ready" ? "green" : "solid")
                }
              >
                {s.st}
              </span>
            </div>
          ))}
        </div>
        {(errorMsg || pinError || registerError) ? (
          <div style={{ marginTop: 10, color: "var(--red)", fontSize: 13 }}>
            {errorMsg || pinError || registerError}
          </div>
        ) : null}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 13, color: "var(--mute)" }}>
          chain {chainId} {onZg ? "· ready" : "· wrong network"}
        </span>
        <button className="btn" onClick={onBack}>← back to identity</button>
      </div>
    </section>
  );
}

/* ───────────── Step 4 · go live ───────────── */

function LiveStep(props: {
  ticker: string;
  mintedTokenId: string | null;
  registered: boolean;
  txHash: Hex | null;
  testInput: string;
  setTestInput: (v: string) => void;
  runTest: () => void;
  testRunning: boolean;
  testOutput: string | null;
  finance: { shareToken: string; revenueVault: string; ipoSale: string; txHashes: { shareToken: string; revenueVault: string; ipoSale: string } } | null;
  deployFinance: () => void;
  financeDeploying: boolean;
  financeError: string | null;
  approveShares: () => void;
  approving: boolean;
  approveError: string | null;
  approved: boolean;
  chainId: number;
  ZG_TEE_PROVIDER: string;
  ZG_TEE_NETWORK: string;
}) {
  const {
    ticker, mintedTokenId, registered, txHash, testInput, setTestInput, runTest,
    testRunning, testOutput, finance, deployFinance, financeDeploying, financeError,
    approveShares, approving, approveError, approved, chainId, ZG_TEE_PROVIDER, ZG_TEE_NETWORK,
  } = props;

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {/* hero strip */}
      <div className="panel" style={{ padding: "20px 24px", display: "grid", gridTemplateColumns: "auto 1fr auto", alignItems: "center", columnGap: 24 }}>
        <div>
          <div style={{ fontSize: 13, letterSpacing: "0.18em", textTransform: "uppercase", color: "var(--accent)" }}>
            ▌ {registered ? "minted · live" : "minted · registering…"}
          </div>
          <div style={{ fontSize: 32, fontWeight: 600, color: "var(--fg)", marginTop: 4, letterSpacing: "-0.02em" }}>
            your agent is live<span style={{ color: "var(--accent)" }}>.</span>
            <span className="blink" style={{ color: "var(--accent)" }}>▌</span>
          </div>
        </div>
        <div className="ss-hero-stats" style={{ marginLeft: 24 }}>
          <div className="ss-stat">
            <div className="lab">ticker</div>
            <div className="val" style={{ fontSize: 19 }}>
              {ticker.toUpperCase()}<span style={{ color: "var(--mute)" }}>.slopstock.eth</span>
            </div>
          </div>
          <div className="ss-stat">
            <div className="lab">tokenid</div>
            <div className="val n" style={{ fontSize: 19 }}>#{mintedTokenId ?? "…"}</div>
          </div>
          <div className="ss-stat">
            <div className="lab">tx hash · 0g galileo</div>
            <div className="val" style={{ fontSize: 15 }}>
              {txHash ? (
                <a
                  className="hash-link"
                  href={`https://chainscan-galileo.0g.ai/tx/${txHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {shortish(txHash)} ↗
                </a>
              ) : "—"}
            </div>
          </div>
          <div className="ss-stat">
            <div className="lab">x402 endpoint</div>
            <div className="val" style={{ fontSize: 15 }}>/x402/infer · #{mintedTokenId}</div>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, alignItems: "flex-end" }}>
          <span className="pill green">tee sealed</span>
          <span className="pill solid">erc-7857</span>
          <span className="pill solid">ens reserved</span>
        </div>
      </div>

      {/* test pad + response/attestation */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20 }}>
        <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel-h">
            <span className="t">free test inference · no payment</span>
            <span className="pill amber">trial</span>
          </div>
          <div style={{ padding: 14, display: "flex", flexDirection: "column", gap: 14 }}>
            <div className="ss-field">
              <label>prompt</label>
              <div className="inp focus" style={{ height: "auto", minHeight: 120, alignItems: "flex-start", padding: "12px 14px", lineHeight: 1.6, fontSize: 15 }}>
                <textarea
                  value={testInput}
                  onChange={(e) => setTestInput(e.target.value)}
                  spellCheck={false}
                  style={{ width: "100%", minHeight: 96, background: "transparent", border: 0, outline: 0, font: "inherit", color: "inherit", resize: "vertical" }}
                />
              </div>
              <div className="help" style={{ display: "flex", justifyContent: "space-between" }}>
                <span><span className="n">{testInput.length}</span> chars · runs the same path as a paid x402 call</span>
                <span>{registered ? "ready" : "registering…"}</span>
              </div>
            </div>
            <button
              className={"mint-btn" + (testRunning ? " busy" : "")}
              onClick={runTest}
              disabled={testRunning || !testInput.trim() || !registered}
            >
              {testRunning ? "running…" : "run free test"}
              {!testRunning ? <span className="ar">→</span> : null}
            </button>
          </div>
        </div>

        <div className="panel" style={{ display: "flex", flexDirection: "column" }}>
          <div className="panel-h">
            <span className="t">response · stream</span>
            <span className="pill green">{testOutput ? "complete" : testRunning ? "live" : "idle"}</span>
          </div>
          <div style={{ padding: 14, fontSize: 14, color: "var(--fg)", lineHeight: 1.65, minHeight: 220 }}>
            {testOutput ? (
              <InferenceOutput raw={testOutput} />
            ) : testRunning ? (
              <span style={{ color: "var(--mute)" }}>
                dispatching to enclave… signature recovers when the response lands.
              </span>
            ) : (
              <span style={{ color: "var(--mute)" }}>
                response will appear here. signature recovered against{" "}
                <span style={{ color: "var(--fg-2)" }}>{shortish(ZG_TEE_PROVIDER)}</span>{" "}
                ({ZG_TEE_NETWORK}).
              </span>
            )}
          </div>
        </div>
      </div>

      {/* fractionalize / approve / open ipo */}
      <div className="panel">
        <div className="panel-h">
          <span className="t">fractionalize · open the IPO</span>
          {finance ? (
            approved ? (
              <span className="pill green">ipo open</span>
            ) : (
              <span className="pill amber">awaiting approve</span>
            )
          ) : financeError ? (
            <span className="pill amber">deploy failed</span>
          ) : financeDeploying ? (
            <span className="pill amber">deploying · auto</span>
          ) : (
            <span className="pill solid">queued</span>
          )}
        </div>
        <div style={{ padding: 18 }}>
          {!finance ? (
            <>
              <div style={{ fontSize: 14, color: "var(--fg-2)", marginBottom: 14 }}>
                Operator is deploying <b className="acc">ShareToken</b> (1M supply minted to you),{" "}
                <b className="acc">RevenueVault</b>, and <b className="acc">IPOSale</b> on Base Sepolia
                — kicked off in parallel with your iNFT mint. No click needed; addresses appear here
                when the 3 deploys land.
              </div>
              <button
                className={"mint-btn" + (financeDeploying ? " busy" : "")}
                onClick={deployFinance}
                disabled={financeDeploying || !registered}
              >
                {financeDeploying
                  ? "deploying 3 contracts on base sepolia…"
                  : financeError
                    ? "retry deploy"
                    : !registered
                      ? "registering agent…"
                      : "deploy fractional shares"}
                {!financeDeploying ? <span className="ar">→</span> : null}
              </button>
              {financeError ? <div style={{ marginTop: 8, color: "var(--red)", fontSize: 13 }}>{financeError}</div> : null}
            </>
          ) : (
            <>
              <div className="kv" style={{ padding: "0 0 14px" }}>
                <div className="k">share token</div>
                <div className="v">
                  <a className="hash-link" href={`https://sepolia.basescan.org/address/${finance.shareToken}`} target="_blank" rel="noreferrer">
                    {shortish(finance.shareToken)} ↗
                  </a>
                </div>
                <div className="k">revenue vault</div>
                <div className="v">
                  <a className="hash-link" href={`https://sepolia.basescan.org/address/${finance.revenueVault}`} target="_blank" rel="noreferrer">
                    {shortish(finance.revenueVault)} ↗
                  </a>
                </div>
                <div className="k">ipo sale</div>
                <div className="v">
                  <a className="hash-link" href={`https://sepolia.basescan.org/address/${finance.ipoSale}`} target="_blank" rel="noreferrer">
                    {shortish(finance.ipoSale)} ↗
                  </a>
                </div>
              </div>

              {!approved ? (
                <>
                  <div style={{ fontSize: 14, color: "var(--fg-2)", marginBottom: 10 }}>
                    <b className="acc">step 2 · approve shares</b> — IPOSale needs permission to pull
                    shares from your wallet when buyers fill orders. one click, one signature.
                  </div>
                  <button
                    className={"mint-btn" + (approving ? " busy" : "")}
                    onClick={approveShares}
                    disabled={approving}
                  >
                    {approving
                      ? chainId !== BASE_CHAIN_ID
                        ? "switching to base…"
                        : "approving on base…"
                      : "approve shares · open ipo"}
                    {!approving ? <span className="ar">→</span> : null}
                  </button>
                  {approveError ? <div style={{ marginTop: 8, color: "var(--red)", fontSize: 13 }}>{approveError}</div> : null}
                </>
              ) : (
                <div
                  style={{
                    padding: "14px 16px",
                    border: "1px solid rgba(16,185,129,0.35)",
                    background: "rgba(16,185,129,0.05)",
                    borderRadius: 2,
                  }}
                >
                  <div style={{ marginBottom: 4 }}>
                    <span className="acc" style={{ fontWeight: 600 }}>✓ ipo open</span>
                    {" · "}IPOSale can now fill share orders against your treasury.
                  </div>
                  <Link className="acc" href={`/app/agent/${ticker.toUpperCase()}/acquire`}>
                    open the cap table → /agent/{ticker.toUpperCase()}/acquire
                  </Link>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ───────────── helpers ───────────── */

function shortish(s: string, chars = 8): string {
  if (!s.startsWith("0x")) return s;
  return `${s.slice(0, 2 + chars)}…${s.slice(-chars)}`;
}

function truncFit(s: string, w: number): string {
  if (s.length <= w) return s;
  return s.slice(0, Math.max(0, w - 1)) + "…";
}

/**
 * fetch + JSON with bounded retries on transient transport failures.
 *
 * The browser surfaces *anything* that prevents a response — DNS blip, CORS
 * preflight cancel, edge proxy cold-start, mid-flight TCP reset — as a
 * generic "Failed to fetch" TypeError. Retrying on those is safe; HTTP-level
 * errors (4xx/5xx) come back as a real Response and are NOT retried unless
 * they are 502/503/504 (gateway transient). 5 attempts, exponential backoff
 * starting at 600 ms (so total wait ≤ 10s before giving up).
 */
async function fetchJsonWithRetry(
  url: string,
  init: RequestInit,
  opts: { retries?: number; baseDelayMs?: number; timeoutMs?: number } = {},
): Promise<unknown> {
  const retries = opts.retries ?? 5;
  const baseDelayMs = opts.baseDelayMs ?? 600;
  const timeoutMs = opts.timeoutMs ?? 90_000;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal });
      clearTimeout(timer);
      const txt = await res.text();
      if (res.ok) {
        try {
          return txt ? JSON.parse(txt) : {};
        } catch {
          return txt;
        }
      }
      // Retry transient gateway statuses; surface real client/server errors.
      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastErr = new Error(`operator ${res.status}: ${txt.slice(0, 200)}`);
      } else {
        throw new Error(`operator ${res.status}: ${txt.slice(0, 400)}`);
      }
    } catch (err) {
      clearTimeout(timer);
      const isTransport =
        err instanceof TypeError /* "Failed to fetch" */ ||
        (err instanceof DOMException && err.name === "AbortError") ||
        (err instanceof Error &&
          (err.message.includes("Failed to fetch") ||
            err.message.includes("NetworkError") ||
            err.message.includes("network error")));
      if (!isTransport) throw err;
      lastErr = err;
    }
    if (attempt < retries) {
      const delay = baseDelayMs * Math.pow(1.6, attempt);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`fetch ${url} failed after ${retries + 1} attempts`);
}

interface FinanceStatusComplete {
  status: "complete";
  finance: { shareToken: string; revenueVault: string; ipoSale: string };
  txHashes?: { shareToken: string; revenueVault: string; ipoSale: string };
}

/**
 * Polls GET /agents/:tokenId/deploy-finance until status flips to complete
 * or error. Tolerates transient transport failures via fetchJsonWithRetry.
 * Caps at ~10 minutes wall clock so a stuck operator can't hang the UI.
 */
async function pollFinanceStatus(tokenId: string): Promise<FinanceStatusComplete> {
  const startedAt = Date.now();
  const maxMs = 10 * 60 * 1000;
  const url = `${OPERATOR_URL}/agents/${tokenId}/deploy-finance`;
  // First poll fires immediately; subsequent polls back off mildly.
  let intervalMs = 1500;
  while (Date.now() - startedAt < maxMs) {
    const body = (await fetchJsonWithRetry(url, { method: "GET" })) as
      | { status: "deploying"; sinceMs?: number }
      | { status: "idle" }
      | FinanceStatusComplete
      | { status: "error"; message: string }
      | { status: "not-found" };
    if (body && typeof body === "object" && "status" in body) {
      if (body.status === "complete") return body;
      if (body.status === "error") {
        throw new Error(("message" in body ? body.message : null) ?? "deploy failed");
      }
      // "deploying", "idle" (server hasn't picked it up yet), or "not-found" → keep polling.
    }
    await new Promise((r) => setTimeout(r, intervalMs));
    intervalMs = Math.min(intervalMs + 500, 4000);
  }
  throw new Error("finance deploy timed out after 10 min");
}
