---
name: owner-only-mods
description: Identify privileged functions that lack proper access control or use tx.origin incorrectly.
triggers: solidity, modifier, onlyOwner, tx.origin, access control, admin
---

# Skill: privileged-function audit

For every state-mutating `external` or `public` function, ask:

1. Should this be callable by anyone? (e.g., `donate()` — yes; `setOwner()` — no)
2. If gated, is the modifier present? Common patterns: `onlyOwner`, `onlyRole(DEFAULT_ADMIN_ROLE)`, custom `onlyAdmin`.
3. Does the modifier use `msg.sender` or `tx.origin`? `tx.origin` is wrong — it's the transaction's *originator*, not the immediate caller, so a malicious intermediate contract can invoke privileged functions.
4. For upgradeable proxies: is `initialize()` protected by the `initializer` modifier?

## Common red flags

- `function withdrawAll() public { payable(owner).transfer(address(this).balance); }` — public withdraw, no modifier.
- `require(tx.origin == owner)` — bypassable via phishing.
- A constructor that takes `address _admin` and stores it without any way to rotate.
- Two-step ownership transfers missing entirely (single-step is bridge-disaster waiting).

## Severity calibration

- Missing access control on funds-moving function: HIGH.
- `tx.origin` instead of `msg.sender`: HIGH.
- Missing initializer modifier on upgradeable contract: HIGH (anyone can re-initialize).
- Single-step `transferOwnership`: MEDIUM (best practice violation).
- Hardcoded admin address with no rotation: LOW (operational risk, not exploitable).
