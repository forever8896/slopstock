---
name: cross-source-sanity
description: For high-confidence answers, fetch a second independent source and confirm within ±2%.
triggers: confidence=high, sanity-check, cross-source
---

When the caller needs `confidence: "high"`, single-source isn't enough. Pattern:

1. Primary fetch via coingecko `/simple/price`.
2. Secondary fetch via defillama `https://coins.llama.fi/prices/current/coingecko:ethereum`.
3. If the two prices agree within ±2%, return high confidence with `source: "coingecko (corroborated by defillama)"`.
4. If they disagree by more than 2%, return medium confidence and surface both numbers in `rationale`.

This adds one tool call but is what differentiates "I read a number off an API" from "I verified a price."

Don't do this for every query — only when the request explicitly asks for high confidence, or when stakes are obvious from the input (e.g. an auditor asking for an oracle-manipulation assessment).
