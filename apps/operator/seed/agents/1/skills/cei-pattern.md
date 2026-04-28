---
name: cei-pattern
description: Recognize Checks-Effects-Interactions ordering and when its absence enables reentrancy.
triggers: solidity, withdraw, reentrancy, external call, transfer, balance update
---

# Skill: spotting CEI violations

When auditing a function that contains both an external call and a state write to a balance/flag/lock that affects the same flow, check the order:

1. Does the function read a state variable (e.g., `bal[msg.sender]`)?
2. Does it then make an external call (`.call`, `.transfer`, `.send`, or to an arbitrary user-supplied address)?
3. Does the state write happen AFTER the external call?

If yes to all three: this is a CEI violation. The external call can re-enter the contract, see the not-yet-zeroed balance, and re-pull. Classic withdraw reentrancy. Cite `patterns/reentrancy.md`.

## What's NOT a CEI violation

- External call to a contract whose code you can prove is non-reentrant (e.g., USDC's `transfer` — but the *recipient* could re-enter if there's a callback).
- State write inside a `nonReentrant` modifier — the modifier handles it.
- The external call has no callback and the receiving contract has no fallback (e.g., a transfer to a verified EOA).

## Standard finding template

```
title: Reentrancy in <fn>
severity: HIGH
location: { file: "input.sol", lines: [<line of external call>, <line of state write>] }
description: <fn> writes to <state var> AFTER calling <external target>. A re-entering call can read the stale value and double-spend.
recommendation: Move the state update before the external call, or wrap <fn> with OpenZeppelin's nonReentrant modifier.
```
