# Stratum Contracts

Foundry workspace for the Stratum smart contracts. Spec: [`../docs/02-smart-contracts.md`](../docs/02-smart-contracts.md).

## Inventory

| Contract | Chain | Status | LoC est |
|---|---|---|---|
| `AgentNFT` (ERC-7857 fork) | 0G Chain | stub | use ref impl |
| `ShareToken` | 0G Chain | stub | ~80 |
| `Fractionalizer` | 0G Chain | stub | ~150 |
| `IPOSale` | Base | stub | ~120 |
| `RevenueVault` | Base | stub | ~200 |
| `Marketplace` | 0G Chain | stub | ~250 |
| `AgentRegistry` | 0G Chain | stub | ~80 |
| `StratumResolver` (CCIP-Read) | Sepolia | stub | ~150 |

## Layout

```
contracts/
├── src/
│   ├── nft/         AgentNFT and related
│   ├── shares/      ShareToken, Fractionalizer
│   ├── revenue/     RevenueVault
│   ├── ipo/         IPOSale
│   ├── market/      Marketplace
│   ├── registry/    AgentRegistry
│   ├── ens/         StratumResolver
│   └── interfaces/  shared interfaces
├── test/            mirror of src/
├── script/          deploy + utility scripts
├── deployments/     committed deployment addresses per network
└── lib/             forge-installed deps (openzeppelin-contracts, forge-std)
```

## Build

```bash
forge build
```

## Test

```bash
forge test
forge test -vvv               # verbose, with stack traces
forge test --match-contract Fractionalizer
forge coverage
```

## Deploy

Deployment scripts in `script/`:

```bash
# Deploy to 0G Galileo testnet
forge script script/DeployStratum.s.sol \
    --rpc-url $ZG_RPC_URL \
    --private-key $DEPLOYER_PRIVATE_KEY \
    --broadcast

# Deploy Base-side contracts
forge script script/DeployBase.s.sol \
    --rpc-url $BASE_RPC_URL \
    --private-key $DEPLOYER_PRIVATE_KEY \
    --broadcast

# Deploy ENS resolver
forge script script/DeployResolver.s.sol \
    --rpc-url $SEPOLIA_RPC_URL \
    --private-key $DEPLOYER_PRIVATE_KEY \
    --broadcast
```

Addresses are written to `deployments/<chain-id>.json` and committed.

## Conventions

- Solidity `^0.8.24`
- All contracts non-upgradeable for v1 (UUPS proxy in v2 if needed)
- All revenue-affecting state changes emit events
- USDC = `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913` on Base mainnet; testnet differs
- Use `SafeERC20` everywhere

## Status

Stubs only. See parent issue tracker / `docs/09-execution-plan.md` for build order.
