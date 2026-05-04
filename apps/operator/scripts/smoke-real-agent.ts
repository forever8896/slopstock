/**
 * smoke test for Real-Agent Launch (PRD §13).
 *
 * No chain, no LLM, no HTTP — exercises the cryptographic + storage path
 * end-to-end:
 *
 *   1. assemble a manifest with one of the shipping templates
 *   2. compute its hash deterministically
 *   3. pin to operator-shadow og-storage
 *   4. fetch back, verify identity
 *   5. tamper with the manifest, verify hash mismatch
 *   6. round-trip the manifest-loader (verify + materialize)
 *
 * Pass = the iNFT story holds: any tampering breaks the hash binding.
 *
 * Usage: bun run scripts/smoke-real-agent.ts
 */

import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  TEMPLATE_LIST,
  canonicalizeJson,
  computeManifestHash,
  validateManifest,
  type AgentManifest,
} from "@stratum/shared";

import {
  _resetOperatorOgStorageForTests,
  getOperatorOgStorage,
} from "../src/storage/og-storage-impl.ts";
import { loadAndMaterialize } from "../src/runtime/manifest-loader.ts";

interface CheckResult {
  name: string;
  ok: boolean;
  detail?: string;
}

const checks: CheckResult[] = [];
function check(name: string, ok: boolean, detail?: string) {
  checks.push({ name, ok, detail });
  const tag = ok ? "✓" : "✗";
  const line = `${tag} ${name}${detail ? ` — ${detail}` : ""}`;
  console.log(line);
}

const dataDir = mkdtempSync(join(tmpdir(), "stratum-smoke-"));
console.log(`[smoke] data dir: ${dataDir}`);

try {
  _resetOperatorOgStorageForTests();
  const ogs = getOperatorOgStorage({ dataDir });

  // 1. Assemble — pick the cross-agent-orchestrator template (the headline).
  const template = TEMPLATE_LIST.find((t) => t.id === "cross-agent-orchestrator");
  if (!template) throw new Error("cross-agent-orchestrator template not found");

  const manifest: AgentManifest = {
    schemaVersion: "stratum/agent-manifest@1",
    identity: {
      ticker: "WHALE",
      name: "WHALE",
      description: "smoke-test agent for the cross-agent orchestrator template.",
      creator: "0x1234567890abcdef1234567890abcdef12345678",
    },
    brain: {
      templateId: template.id,
      systemPrompt: template.systemPrompt,
      model: template.defaultModel,
      backend: "openai-compat",
      runtimeTier: template.suggestedTier,
    },
    capabilities: {
      tools: [...template.tools],
      patterns: (template.patterns ?? []).map((p) => ({ name: p.name, body: p.body })),
      skills: (template.skills ?? []).map((s) => ({ name: s.name, body: s.body })),
    },
    pricing: {
      perCallSmallest: "100000",
      perCallHuman: "$0.10",
    },
    meta: { createdAt: 1000 },
  };

  check("manifest validates", validateManifest(manifest) === null);

  // 2. Hash determinism — recompute & compare.
  const h1 = computeManifestHash(manifest);
  const h2 = computeManifestHash(structuredClone(manifest));
  check("hash deterministic", h1 === h2, h1.slice(0, 18) + "…");

  // 3. Canonicalization key-order invariance.
  const reordered = JSON.parse(JSON.stringify(manifest));
  // Reverse field order at top level by re-creating the object.
  const reorderedManifest = {
    meta: reordered.meta,
    pricing: reordered.pricing,
    capabilities: reordered.capabilities,
    brain: reordered.brain,
    identity: reordered.identity,
    schemaVersion: reordered.schemaVersion,
  } as AgentManifest;
  const h3 = computeManifestHash(reorderedManifest);
  check("hash invariant under key reorder", h3 === h1);

  // Also verify canonicalize is sorted (sanity — first field should be alphabetical).
  const canon = canonicalizeJson(manifest);
  const firstKey = canon.match(/^\{"([^"]+)"/)?.[1] ?? "";
  check("canonical first key is 'brain' (alphabetical)", firstKey === "brain", `got '${firstKey}'`);

  // 4. Pin → fetch round-trip.
  const pinResult = await ogs.pinJson(manifest);
  const fetched = await ogs.fetchJson<AgentManifest>(pinResult.rootHash);
  const fetchedHash = computeManifestHash(fetched);
  check(
    "pin → fetch byte-equal",
    fetchedHash === h1,
    `pin=${pinResult.rootHash.slice(0, 12)}… fetched=${fetchedHash.slice(2, 14)}…`,
  );
  check("pinResult.uri starts with 0g-storage://", pinResult.uri.startsWith("0g-storage://"));

  // 5. Tampering breaks the hash.
  const tampered: AgentManifest = {
    ...manifest,
    capabilities: {
      ...manifest.capabilities,
      tools: ["query_agent"],   // template has 3 tools; we cut to 1
    },
  };
  const tHash = computeManifestHash(tampered);
  check("tampering changes hash", tHash !== h1);

  // 6. Manifest-loader: verify + materialize.
  const materialized = await loadAndMaterialize({
    tokenId: "999",
    bundleManifestCid: pinResult.rootHash,
    manifestShadow: manifest,
    dataDir,
  });
  check("loader materializes a dir", typeof materialized.agentDir === "string" && materialized.agentDir.length > 0);
  check(
    "materialized hash matches",
    `0x${materialized.manifestHash}` === h1.toLowerCase(),
    `materialized=${materialized.manifestHash.slice(0, 12)}… expected=${h1.slice(2, 14)}…`,
  );

  // 7. Loader rejects mismatched cid.
  let mismatchCaught = false;
  try {
    await loadAndMaterialize({
      tokenId: "1000",
      bundleManifestCid: tHash,             // tampered hash
      manifestShadow: manifest,             // original manifest
      dataDir,
    });
  } catch (e) {
    mismatchCaught = (e as Error).message.includes("hash mismatch");
  }
  check("loader rejects hash mismatch", mismatchCaught);

  // 8. Verify all 5 templates pin successfully.
  let allTemplatesPin = true;
  for (const t of TEMPLATE_LIST) {
    const m: AgentManifest = {
      ...manifest,
      identity: { ...manifest.identity, ticker: t.id.slice(0, 6).toUpperCase().replace(/-/g, "") },
      brain: {
        ...manifest.brain,
        templateId: t.id,
        systemPrompt: t.systemPrompt,
        runtimeTier: t.suggestedTier,
      },
      capabilities: {
        tools: [...t.tools],
        patterns: (t.patterns ?? []).map((p) => ({ name: p.name, body: p.body })),
        skills: (t.skills ?? []).map((s) => ({ name: s.name, body: s.body })),
      },
    };
    if (validateManifest(m) !== null) {
      allTemplatesPin = false;
      check(`template ${t.id} validates`, false, validateManifest(m) ?? "");
      continue;
    }
    const pin = await ogs.pinJson(m);
    if (!pin.rootHash) allTemplatesPin = false;
  }
  check("all 5 templates assemble + validate + pin", allTemplatesPin);
} finally {
  rmSync(dataDir, { recursive: true, force: true });
}

const failed = checks.filter((c) => !c.ok);
console.log("\n────────────────────────────────────────────");
if (failed.length === 0) {
  console.log(`✓ ${checks.length}/${checks.length} smoke checks passed`);
  process.exit(0);
}
console.log(`✗ ${failed.length}/${checks.length} smoke checks failed`);
for (const f of failed) console.log(`  ✗ ${f.name}${f.detail ? ` — ${f.detail}` : ""}`);
process.exit(1);
