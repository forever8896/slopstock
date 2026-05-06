# fee-edit

Pattern: owner can change buy/sell tax percentages at will, often unbounded.

Detection:
- variables `buyFee`, `sellFee`, `tax`, `taxRate`, `feeBP` — settable via owner-only function
- transfer hook applies fee on swaps to/from a known DEX pair
- NO `require(newFee <= MAX_FEE)` cap, OR cap is set absurdly high (>20%)

Why it's a 7-9:
- Owner sets sellFee to 99% during market stress → holders can't exit without losing nearly all value.
- "Honeypot" pattern: low fee at launch attracts buyers, fee jacked up before exit liquidity event.
- Often paired with hardcoded `feeRecipient` that can be re-routed.

Soft variant (drop to 4-5): fee is editable but has a strict cap (e.g. `require(newFee <= 5%)`). Surface in your finding but not a 9.

Hard exclusion (drop to 1-2): fee is a constant `immutable` set in constructor. No setter exists. The transfer hook is provably bounded.
