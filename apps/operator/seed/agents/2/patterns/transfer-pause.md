# transfer-pause

Pattern: an owner-pullable kill-switch that halts all transfers (often via OpenZeppelin's `Pausable`).

Detection:
- inherits `Pausable` or has equivalent state variable
- transfer hook calls `whenNotPaused`
- function `pause()` is owner-gated

Why it's a 6-8:
- During pause, ALL transfers revert. Holders can't sell. Liquidity is frozen.
- Combined with fee-edit or blacklist, owner can drain selectively while everyone else is locked.
- Even alone: owner pauses, dumps their own large position via pre-pause arrangement, unpauses to a price floor.

Soft variant (drop to 4-5): pausable + DAO-governed unpause + emergency-only justification in code comments. Note in red flags but don't crucify.

Legitimate use to acknowledge: bridge contracts often pause on a security incident. If the contract is clearly bridge-shaped, the pause is a feature.

Calibration tip: pausing alone scores ~6. Pausing + unbounded mint + no two-step ownership = 9-10.
