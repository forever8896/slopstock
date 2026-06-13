# Launch Rework — Plan 1: Simplification (Hermes-only, 0G-v4, no presets) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every permissionlessly-launched agent run the Hermes harness on the single 0G-mainnet deepseek-v4 backend, seeded from a free-form system prompt — removing capability presets, the multi-runtime/multi-backend matrix, and the manifest requirement from the launch path.

**Architecture:** The runtime router's *dynamic* (launched-agent) branch is forced to `HermesAgentRuntime` + `0g-compute`; the agent's `system.md` is seeded from the creator's `systemPrompt` at register time (Hermes `load()` already reads an existing `system.md`). The `/agents/register` body is slimmed and the `templates.ts` / `/templates` preset surface is deleted. Legacy seed tokens (1/2/3) are untouched — they flow through the static (non-dynamic) router branch.

**Tech Stack:** Bun, TypeScript, viem, `bun:test`. Spec: `docs/superpowers/specs/2026-06-13-launch-rework-design.md` (§1, §2, §5).

**Scope guard:** This plan does NOT touch payments, 1Claw, LI.FI, or auto-registration (plans 2–5). It must not change legacy-token behavior or the contract-deploy step.

---

### Task 1: Seed an agent's `system.md` from its system prompt

**Files:**
- Create: `apps/operator/src/runtime/seed-agent-dir.ts`
- Test: `apps/operator/src/runtime/seed-agent-dir.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { seedAgentSystemPrompt } from "./seed-agent-dir.ts";

test("writes system.md from the prompt when none exists", async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-"));
  await seedAgentSystemPrompt(root, 42n, "You are a haiku agent.");
  expect(await readFile(join(root, "42", "system.md"), "utf-8")).toBe("You are a haiku agent.");
});

test("does NOT overwrite an existing system.md (self-improvement preserved)", async () => {
  const root = await mkdtemp(join(tmpdir(), "seed-"));
  await mkdir(join(root, "7"), { recursive: true });
  await writeFile(join(root, "7", "system.md"), "EVOLVED PROMPT");
  await seedAgentSystemPrompt(root, 7n, "original");
  expect(await readFile(join(root, "7", "system.md"), "utf-8")).toBe("EVOLVED PROMPT");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/operator/src/runtime/seed-agent-dir.test.ts`
Expected: FAIL — `seedAgentSystemPrompt` is not defined.

- [ ] **Step 3: Write minimal implementation**

```ts
// apps/operator/src/runtime/seed-agent-dir.ts
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";

/** Seed a launched agent's system prompt to <dataDir>/<tokenId>/system.md.
 *  Idempotent + non-destructive: never overwrites an existing system.md, so a
 *  self-improved prompt survives. Hermes load() reads this file if present. */
export async function seedAgentSystemPrompt(dataDir: string, tokenId: bigint, systemPrompt: string): Promise<void> {
  const dir = join(dataDir, tokenId.toString());
  await mkdir(dir, { recursive: true });
  const sysPath = join(dir, "system.md");
  if (!existsSync(sysPath)) await writeFile(sysPath, systemPrompt);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/operator/src/runtime/seed-agent-dir.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/runtime/seed-agent-dir.ts apps/operator/src/runtime/seed-agent-dir.test.ts
git commit -m "feat(launch): seed agent system.md from systemPrompt (idempotent)"
```

---

### Task 2: Force the dynamic router branch to Hermes + 0g-compute

**Files:**
- Modify: `apps/operator/src/runtime/index.ts` (the `if (dyn)` block in `forToken`, ~lines 63–123)
- Test: `apps/operator/src/runtime/router-dynamic.test.ts`

**Context:** Today the dynamic branch picks backend from `dyn.backend` and only returns `HermesAgentRuntime` when a manifest + `runtimeTier==="hermes"` is present, otherwise a one-shot `OpenAICompatRuntime`. New behavior: a launched agent ALWAYS gets Hermes + the shared `0g-compute` backend, seeded from `dyn.systemPrompt`. The static (non-dynamic) branch below is unchanged.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { buildRuntimeRouter } from "./index.ts";
import { loadConfig } from "../config.ts";
import { registerDynamicAgent, clearDynamicRegistryForTest } from "../store/dynamic-registry.ts";

test("a launched (dynamic) agent routes to Hermes on 0g-compute", async () => {
  clearDynamicRegistryForTest?.();
  await registerDynamicAgent({
    tokenId: "900001", ticker: "HAIKU", description: "d",
    systemPrompt: "You are a haiku agent.", model: "deepseek-v4-flash",
    perCallSmallest: "100000", perCallHuman: "$0.10",
    runtime: "hermes", backend: "0g-compute",
    creator: "0x0000000000000000000000000000000000000001",
    txHash: "0x" + "0".repeat(64), createdAt: 0,
  });
  const router = buildRuntimeRouter(loadConfig());
  const rt = await router.forToken(900001n);
  expect(rt.kind).toBe("hermes");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/operator/src/runtime/router-dynamic.test.ts`
Expected: FAIL — either `clearDynamicRegistryForTest` missing, or `rt.kind` is `"openai-compat"` (no manifest → current code returns the one-shot runtime).

- [ ] **Step 3: Add the test helper to the registry**

In `apps/operator/src/store/dynamic-registry.ts`, export a test reset (place near the in-memory map):

```ts
/** Test-only: clear the in-memory dynamic registry. */
export function clearDynamicRegistryForTest(): void {
  agents.clear(); // `agents` is the module-level Map<string, DynamicAgent>
}
```

(If the in-memory store has a different name, clear that structure instead.)

- [ ] **Step 4: Rewrite the dynamic branch in `forToken`**

Replace the body of `if (dyn) { ... }` (the backend-selection + manifest/tier branching) with:

```ts
    if (dyn) {
      // Every launched agent: Hermes harness on the single shared 0g-compute v4 backend.
      // (No presets, no per-agent backend/runtime choice, no manifest requirement.)
      const backend = await this.backendFor("0g-compute");
      await (await import("./seed-agent-dir.ts")).seedAgentSystemPrompt(
        this.config.AGENTS_DATA_DIR, dyn.tokenId, dyn.systemPrompt,
      );
      const h = new HermesAgentRuntime(this.config, backend);
      if (this.clients) h.attachOperatorContext(this.clients);
      return h; // not cached: the registry can change at runtime
    }
```

Remove the now-unused `loadAndMaterialize` / `ManifestLoadError` import and the `OpenAICompatBackend` per-agent construction if they are no longer referenced in this file (let the compiler/test guide you).

- [ ] **Step 5: Run test to verify it passes**

Run: `bun test apps/operator/src/runtime/router-dynamic.test.ts`
Expected: PASS.

- [ ] **Step 6: Guard against legacy regressions**

Run: `bun test apps/operator/src/runtime`
Expected: PASS (existing router/hermes tests still green — legacy tokens use the static branch).

- [ ] **Step 7: Commit**

```bash
git add apps/operator/src/runtime/index.ts apps/operator/src/store/dynamic-registry.ts apps/operator/src/runtime/router-dynamic.test.ts
git commit -m "feat(launch): launched agents always route to Hermes on 0g-compute v4"
```

---

### Task 3: Slim the `/agents/register` contract + force runtime/backend

**Files:**
- Modify: `apps/operator/src/http/server.ts` (`handleRegisterAgent`, ~lines 239–331)
- Test: `apps/operator/src/http/register-slim.test.ts`

**Context:** Drop the manifest/`runtimeTier`/`templateId` branching and the `body.runtime`/`body.backend` reads. Force `runtime: "hermes"`, `backend: "0g-compute"`. Require `{ ticker, name, description, systemPrompt, perCallSmallest (or perCallUsd), creator, txHash }`. Keep an optional `tools` passthrough (stored, used by later plans). `perCallUsd`→`perCallSmallest` conversion stays as-is.

- [ ] **Step 1: Write the failing test**

```ts
import { test, expect } from "bun:test";
import { buildHttpServer } from "./server.ts"; // or the register handler if exported
// If handleRegisterAgent isn't exported, export it for testing.
import { handleRegisterAgent } from "./server.ts";
import { loadConfig } from "../config.ts";

function req(body: unknown) {
  return new Request("http://x/agents/register", { method: "POST", body: JSON.stringify(body) });
}

test("slim register forces hermes + 0g-compute and rejects missing fields", async () => {
  const deps = { config: loadConfig() } as never;
  const bad = await handleRegisterAgent(req({ ticker: "X" }), deps);
  expect(bad.status).toBe(400);

  const ok = await handleRegisterAgent(req({
    tokenId: "900002", ticker: "HAIKU", name: "Haiku", description: "d",
    systemPrompt: "You are a haiku agent.", perCallSmallest: "100000",
    creator: "0x0000000000000000000000000000000000000001", txHash: "0x" + "0".repeat(64),
  }), deps);
  expect(ok.status).toBeLessThan(300);
  const body = await ok.json();
  expect(body.agent.runtime).toBe("hermes");
  expect(body.agent.backend).toBe("0g-compute");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun test apps/operator/src/http/register-slim.test.ts`
Expected: FAIL — `handleRegisterAgent` not exported, or the response shape/forcing differs.

- [ ] **Step 3: Slim the handler**

In `handleRegisterAgent`: export it; delete the `if (body.manifest) { ... }` block, the `templateId`/`runtimeTier` locals, and the `getOperatorOgStorage(...).pinJson` manifest pin. Set the required-field list to `["tokenId","ticker","description","systemPrompt","perCallSmallest","creator","txHash"]` (accept `perCallUsd` as an alternate that converts to `perCallSmallest`). Build the record with hard-coded `runtime: "hermes"`, `backend: "0g-compute"`, and an optional `tools: body.tools` passthrough. Drop `templateId`/`runtimeTier`/`manifestShadow`/`bundleManifestCid` from the record.

- [ ] **Step 4: Run test to verify it passes**

Run: `bun test apps/operator/src/http/register-slim.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/operator/src/http/server.ts apps/operator/src/http/register-slim.test.ts
git commit -m "feat(launch): slim register contract; force hermes + 0g-compute"
```

---

### Task 4: Remove the preset surface (`templates.ts`, `/templates`, `templateId`)

**Files:**
- Delete: `packages/shared/src/templates.ts`
- Modify: `packages/shared/src/index.ts` (drop `export * from "./templates"` if present), `apps/operator/src/http/server.ts` (remove `TEMPLATE_LIST` import + the `GET /templates` route), `apps/operator/src/store/dynamic-registry.ts` (drop `templateId?` field), `apps/operator/src/runtime/manifest-loader.ts` + `apps/operator/src/runtime/tools-lite.ts` (remove `manifest.brain.templateId` references)
- Test: reuse the suite

- [ ] **Step 1: Find every reference**

Run: `grep -rn "templates\|TEMPLATE_LIST\|templateId\|getTemplate\|CapabilityTemplate" packages/shared/src apps/operator/src | grep -v test`
Expected: a finite list — `templates.ts`, the `/templates` route, `templateId` in `dynamic-registry.ts`, `tools-lite.ts`, `manifest-loader.ts`.

- [ ] **Step 2: Delete the route + export**

In `server.ts`, remove the `import { ..., TEMPLATE_LIST, ... }` entry and the block:
```ts
if (url.pathname === "/templates" && req.method === "GET") {
  return withCors(json({ templates: TEMPLATE_LIST }));
}
```
In `packages/shared/src/index.ts`, remove the `templates` re-export line.

- [ ] **Step 3: Delete the file + strip stragglers**

```bash
git rm packages/shared/src/templates.ts
```
Remove the `templateId?` field from `DynamicAgent` and the `manifest.brain.templateId` reads in `tools-lite.ts` / `manifest-loader.ts` (those manifest paths are legacy-only and no longer reached by launch; if a reference is load-bearing for legacy, replace with a literal `"legacy"` rather than re-introducing templates).

- [ ] **Step 4: Verify the build + full suite**

Run: `bun build apps/operator/src/index.ts --target bun --outfile /dev/null`
Expected: BUILD OK (no unresolved `templates` imports).

Run: `bun test packages/shared apps/operator`
Expected: no NEW failures vs. the baseline (181 pass / 1 skip / 3 fail — the 3 are pre-existing demo-script GitHub-integration tests).

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(launch): remove capability presets (templates.ts, /templates, templateId)"
```

---

## Self-Review

- **Spec coverage:** §1 slim contract → Task 3; §2 forced runtime/provider → Tasks 1+2; §5 removals → Task 4. (§3 payments, §4 1Claw, §6 errors, §7 auto-reg, §8 are plans 2–5 — out of scope here, by design.)
- **Placeholder scan:** every step has concrete code/commands; the one judgment call (Task 4 Step 3 "if load-bearing for legacy") is explicit, not a TODO.
- **Type consistency:** `seedAgentSystemPrompt(dataDir, tokenId, systemPrompt)` defined in Task 1, called identically in Task 2; `clearDynamicRegistryForTest()` defined + used in Task 2; record fields `runtime`/`backend` referenced consistently in Tasks 2–3.
- **Legacy guard:** Tasks 2 & 4 each re-run the existing suite to confirm legacy tokens (static branch) are untouched.
