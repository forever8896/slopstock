#!/usr/bin/env bash
set -euo pipefail

# Deploy the 0G-side singletons (AgentNFT, Fractionalizer, Marketplace, AgentRegistry).
# Writes deployments/zg-galileo.json.
#
# Stub. See contracts/script/DeployStratum.s.sol.

cd "$(dirname "$0")/../contracts"

forge script script/DeployStratum.s.sol \
    --rpc-url "${ZG_RPC_URL:?ZG_RPC_URL not set}" \
    --private-key "${DEPLOYER_PRIVATE_KEY:?DEPLOYER_PRIVATE_KEY not set}" \
    --broadcast
