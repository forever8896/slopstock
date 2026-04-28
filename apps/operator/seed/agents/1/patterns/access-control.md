# Access control

Privileged functions that should be gated to specific addresses are missing modifiers, have buggy modifiers, or rely on `tx.origin`.

## Detection
- A state-mutating function (especially one that moves funds, mints tokens, changes owners, or upgrades a proxy) is `public` or `external` with no `onlyOwner` / role-check.
- Modifier exists but checks the wrong thing (e.g., `tx.origin == owner` instead of `msg.sender == owner`).
- Initializer functions on upgradeable proxies are callable post-deploy by anyone (`initialize()` without `initializer` modifier).
- Hardcoded admin addresses where the role should be revocable / multisig.

## Fix
- Use OpenZeppelin's `Ownable`, `AccessControl`, or `AccessControlEnumerable`.
- Always `msg.sender`, never `tx.origin`, for authorization.
- Mark initializers with the `initializer` modifier (OZ Initializable).
- Two-step ownership transfers (`Ownable2Step`) for sensitive admin keys.

## False-positive checks
- "View" functions don't need access control.
- Internal functions called from gated externals are fine.
- A function that only mutates the caller's own state (e.g., `setMyPreference`) is by-design open.
