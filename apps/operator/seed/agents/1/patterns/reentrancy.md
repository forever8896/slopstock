# Reentrancy

External call to an untrusted address before state writes are settled.

## Detection
- A function makes an external call (`.call{value: x}("")`, `.transfer`, `.send`, or to an arbitrary address) BEFORE updating a state variable that affects the same flow.
- Especially dangerous in withdraw / payout patterns where a user's balance is the gating variable.
- Cross-function reentrancy: Function A reads state, calls external, then writes state. Function B reads the same state mid-call → can drain.

## Fix
- Apply checks-effects-interactions: write all state BEFORE making external calls.
- Use OpenZeppelin's `ReentrancyGuard` (`nonReentrant` modifier).
- Pull-pattern over push-pattern for payouts when feasible.

## Famous incidents
- The DAO (2016, $60M)
- Cream Finance (2021, $130M)
- Fei Rari (2022, $80M)

## False-positive checks
- If the only external call is to a known immutable contract (e.g., USDC's `transferFrom`), reentrancy via that path is impossible — but the *receiver* of any transfer could still re-enter if there's a callback.
- ERC-777 + ERC-721 `safeTransfer` paths invoke recipient hooks; treat those as external calls.
