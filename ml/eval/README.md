# eval

Eval harness for the audit agent.

## Checks

- **Reentrancy detection** — must flag the bug in `tests/DemoVault.sol`.
- **Access control** — must flag missing `onlyOwner` in `tests/DemoToken.sol`.
- **Race condition** — must flag `commitVote/revealVote` issue in `tests/DemoVoting.sol`.
- **False-positive rate** — must be < 30% on a clean OpenZeppelin contract.
- **Schema compliance** — output must validate against the JSON schema in `docs/08-hero-agent.md` §4.2.

## Files (planned)

- `tests/Demo*.sol` — staged contracts with known bugs
- `expected/` — committed expected outputs (regression baseline)
- `run.py` — invokes the agent, diffs against expected, writes `metrics.json`
