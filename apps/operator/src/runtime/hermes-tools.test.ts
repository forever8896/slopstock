import { describe, expect, test } from "bun:test";
import { mkdtemp, mkdir } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import { TOOL_REGISTRY, type ToolCtx } from "./hermes-tools.ts";
import { readSkillBody } from "./skills.ts";

async function ctxWithDir(): Promise<ToolCtx> {
  const dir = await mkdtemp(join(tmpdir(), "hermes-tools-"));
  await mkdir(join(dir, "skills"), { recursive: true });
  // Minimal ToolCtx — these tools only touch agentDir.
  return {
    input: "", agentDir: dir, db: undefined as never, callId: "t", callerTokenId: 1n,
    subscriber: "0x0000000000000000000000000000000000000000", config: {} as never,
    peerOperatorUrl: "http://127.0.0.1:0",
  };
}

describe("skill_manage / skills_list / skill_view round-trip", () => {
  test("create → list → view", async () => {
    const ctx = await ctxWithDir();
    const created = await TOOL_REGISTRY["skill_manage"]!.handler(
      { op: "create", name: "Oracle Manipulation", content: "Use TWAP. Check staleness." }, ctx,
    );
    expect(created.resultSummary).toContain("create");

    const listed = await TOOL_REGISTRY["skills_list"]!.handler({}, ctx);
    expect(listed.text).toContain("oracle-manipulation");

    const viewed = await TOOL_REGISTRY["skill_view"]!.handler({ name: "oracle-manipulation" }, ctx);
    expect(viewed.text).toContain("Use TWAP");
    expect(viewed.text).toContain("version: 1");
  });

  test("edit bumps version in place (self-improvement, no duplicate)", async () => {
    const ctx = await ctxWithDir();
    await TOOL_REGISTRY["skill_manage"]!.handler({ op: "create", name: "reentrancy", content: "v1" }, ctx);
    await TOOL_REGISTRY["skill_manage"]!.handler({ op: "edit", name: "reentrancy", content: "v2 better" }, ctx);
    const body = await readSkillBody(ctx.agentDir, "reentrancy");
    expect(body).toContain("v2 better");
    expect(body).toContain("version: 2");
    const listed = await TOOL_REGISTRY["skills_list"]!.handler({}, ctx);
    expect(listed.text.match(/reentrancy/g)?.length).toBe(1); // exactly one, not duped
  });

  test("skill_view miss lists available", async () => {
    const ctx = await ctxWithDir();
    const r = await TOOL_REGISTRY["skill_view"]!.handler({ name: "ghost" }, ctx);
    expect(r.resultSummary).toContain("miss");
  });
});

test("note appends to MEMORY.md as well as the facts table", async () => {
  const ctx = await ctxWithDir();
  const db = new Database(":memory:");
  db.exec("CREATE TABLE facts (key TEXT PRIMARY KEY, value TEXT NOT NULL, ts INTEGER NOT NULL);");
  (ctx as { db: Database }).db = db;

  await TOOL_REGISTRY["note"]!.handler({ key: "oracle-rule", value: "prefer TWAP" }, ctx);

  const raw = await readFile(join(ctx.agentDir, "MEMORY.md"), "utf-8");
  expect(raw).toContain("oracle-rule: prefer TWAP");
  const row = db.prepare("SELECT value FROM facts WHERE key = ?").get("oracle-rule") as { value: string };
  expect(row.value).toBe("prefer TWAP");
});

describe("credentialed_fetch — 1Claw-resolved credential injection", () => {
  test("resolves the secret and attaches it as the chosen header (value never leaks)", async () => {
    const ctx = await ctxWithDir();
    const SECRET = "sk_live_super_secret_value_123";
    (ctx as { resolveSecret?: (r: string) => Promise<string> }).resolveSecret = async (ref) => {
      expect(ref).toBe("ethglobal-skills");
      return SECRET;
    };
    let captured: Record<string, string> = {};
    const orig = globalThis.fetch;
    globalThis.fetch = (async (_url: string, init: { headers?: Record<string, string> }) => {
      captured = init?.headers ?? {};
      return new Response("ok-body", { status: 200 });
    }) as unknown as typeof fetch;
    try {
      const r = await TOOL_REGISTRY["credentialed_fetch"]!.handler(
        { url: "https://ethglobalskills.vercel.app/api/sponsors?keyword=ens", secretRef: "ethglobal-skills", headerName: "x-api-key" },
        ctx,
      );
      expect(captured["x-api-key"]).toBe(SECRET);       // key actually attached
      expect(r.text).toContain("200");
      expect(r.text).toContain("ok-body");
      expect(r.text).not.toContain(SECRET);              // LEAK GUARD: model never sees the value
      expect(r.resultSummary).not.toContain(SECRET);
    } finally {
      globalThis.fetch = orig;
    }
  });

  test("fail-soft when 1Claw not configured (no resolveSecret)", async () => {
    const ctx = await ctxWithDir();
    const r = await TOOL_REGISTRY["credentialed_fetch"]!.handler({ url: "https://example.com", secretRef: "x" }, ctx);
    expect(r.resultSummary).toContain("1claw");
  });

  test("refuses private host before resolving any secret", async () => {
    const ctx = await ctxWithDir();
    let resolved = false;
    (ctx as { resolveSecret?: (r: string) => Promise<string> }).resolveSecret = async () => { resolved = true; return "s"; };
    const r = await TOOL_REGISTRY["credentialed_fetch"]!.handler({ url: "http://127.0.0.1:9/x", secretRef: "x" }, ctx);
    expect(r.resultSummary).toContain("private host");
    expect(resolved).toBe(false);
  });
});
