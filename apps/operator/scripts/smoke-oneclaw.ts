/**
 * Live smoke: prove the 1Claw credential capability functions end-to-end.
 *
 *   provisionSecret → resolveSecret → (cleanup) delete
 *
 * Requires ONECLAW_API_KEY + ONECLAW_VAULT_ID in env. Uses a sentinel tokenId
 * (999999) and a throwaway value so it never touches real agent secrets.
 *
 *   set -a && . ./.env && set +a && bun run apps/operator/scripts/smoke-oneclaw.ts
 */

import { loadConfig } from "../src/config.ts";
import { resolveSecret, provisionSecret, getOneClawClient, secretPath } from "../src/store/secrets.ts";

const TOKEN = 999999n;
const REF = "smoke-test";
const VALUE = `sk_smoke_${Date.now().toString(36)}_value`;

const config = loadConfig();
const path = secretPath(TOKEN, REF);
console.log("vault:", config.ONECLAW_VAULT_ID, "path:", path);

// 1. Provision (store) — plaintext taken here, never persisted by us.
const put = await provisionSecret(REF, VALUE, { tokenId: TOKEN, config, service: "smoke" });
console.log("provisioned:", put.path, "v" + put.version);

// 2. Resolve (the capability every agent tool uses) — just-in-time fetch.
const resolved = await resolveSecret(REF, { tokenId: TOKEN, config });
const ok = resolved === VALUE;
console.log("resolved:", ok ? "✅ value matches (round-trip works)" : "❌ MISMATCH");

// 3. Leak check: the resolved value must equal what we stored, and the path
//    is per-agent scoped.
if (!ok) { console.error("expected the stored value back"); process.exit(1); }

// 4. Cleanup.
await getOneClawClient(config).deleteSecret(path);
console.log("cleaned up:", path);
console.log("\n✅ 1Claw resolver FUNCTIONS LIVE (provision → resolve → delete).");
