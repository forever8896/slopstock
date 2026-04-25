# scripts

One-shot deploy + setup utilities. Each is idempotent where possible.

## Files (planned)

| Script | Purpose |
|---|---|
| `deploy-stratum.sh` | Deploy 0G-side singletons, write deployments/zg-galileo.json |
| `deploy-base.sh` | Deploy Base-side per-agent contracts |
| `deploy-resolver.sh` | Deploy ENS CCIP-Read resolver to Sepolia |
| `mint-hero-agent.sh` | End-to-end: encrypt → upload → mint → fractionalize → IPO config |
| `seed-demo-data.sh` | Run a few paid inferences before the demo so dashboards aren't empty |
| `setup-keeperhub.sh` | Register the weekly distribute workflow + ERC-8004 publish |
| `setup-ens.sh` | Register stratum.eth, set resolver, set ENSIP-25 text records |
