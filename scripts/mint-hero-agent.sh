#!/usr/bin/env bash
# Mint the hero AUDIT agent end-to-end:
#   1. Mint StratumAgentNFT on 0G Chain (script/MintAgent.s.sol)
#   2. Deploy ShareToken / RevenueVault / IPOSale on Base Sepolia (script/DeployBase.s.sol)
#   3. Pin cross-chain pointers via setMappings on the iNFT
#   4. Register the agent in AgentRegistry on 0G
#
# Reads addresses from contracts/deployments/zg-galileo.json (produced by DeployStratum).
# Requires: .env with DEPLOYER_PRIVATE_KEY, ZG_RPC_URL, BASE_RPC_URL.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
CONTRACTS_DIR="$ROOT_DIR/contracts"
DEPLOYMENTS_DIR="$CONTRACTS_DIR/deployments"

# ─── Hero agent constants ──────────────────────────────────────────────
TICKER="AUDIT"
AGENT_NAME="Auditor Shares"
ENS_NAME="auditor.stratum.eth"
METADATA_URI="ipfs://QmStratumAuditAgentTestnetPlaceholderHash/auditor.json"

# ─── Base Sepolia: real Circle testnet USDC ────────────────────────────
USDC_BASE="0x036CbD53842c5426634e7929541eC2318f3dCF7e"

# ─── IPO terms ─────────────────────────────────────────────────────────
IPO_PRICE="1000000"                         # $1.00 in USDC's 6 decimals
IPO_MAX_SHARES="300000000000000000000000"    # 300_000 ether (300k of 1M total)
IPO_STARTS_AT=$(($(date +%s) + 60))          # 1 minute from now (so first sale opens fast)
IPO_ENDS_AT=$(($(date +%s) + 7 * 24 * 3600)) # 7-day window

# ─── 0G gas overrides ──────────────────────────────────────────────────
ZG_GAS_FLAGS=(--priority-gas-price 2000000000 --gas-price 5000000000)
# Foundry's `forge script` uses --with-gas-price; cast send uses --gas-price.
# We pass each through its respective flag at the call site.
ZG_FORGE_GAS_FLAGS=(--priority-gas-price 2000000000 --with-gas-price 5000000000)

# ─── Load env ──────────────────────────────────────────────────────────
set -a
. "$ROOT_DIR/.env"
set +a

ZG_DEPLOY="$DEPLOYMENTS_DIR/zg-galileo.json"
[[ -f "$ZG_DEPLOY" ]] || { echo "missing $ZG_DEPLOY — run scripts/deploy-stratum.sh first" >&2; exit 1; }

AGENT_NFT_0G=$(jq -r .agentNft "$ZG_DEPLOY")
AGENT_REGISTRY=$(jq -r .agentRegistry "$ZG_DEPLOY")
echo "agentNft (0G):    $AGENT_NFT_0G"
echo "agentRegistry:    $AGENT_REGISTRY"

# ─── Step 1: mint iNFT on 0G ───────────────────────────────────────────
echo
echo "[1/4] minting $TICKER iNFT on 0G…"
cd "$CONTRACTS_DIR"
AGENT_NFT_0G="$AGENT_NFT_0G" \
AGENT_TICKER="$TICKER" \
AGENT_ENS_NAME="$ENS_NAME" \
AGENT_METADATA_URI="$METADATA_URI" \
forge script script/MintAgent.s.sol \
    --rpc-url "$ZG_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast --skip-simulation \
    "${ZG_FORGE_GAS_FLAGS[@]}"

MINT_ARTIFACT="$DEPLOYMENTS_DIR/agent-${TICKER}-mint.json"
TOKEN_ID=$(jq -r .tokenId "$MINT_ARTIFACT")
echo "minted tokenId: $TOKEN_ID"

# ─── Step 2: deploy Base bundle ────────────────────────────────────────
echo
echo "[2/4] deploying ShareToken/RevenueVault/IPOSale on Base Sepolia…"
AGENT_NFT_0G="$AGENT_NFT_0G" \
AGENT_TOKEN_ID="$TOKEN_ID" \
AGENT_TICKER="$TICKER" \
AGENT_NAME="$AGENT_NAME" \
USDC_BASE="$USDC_BASE" \
IPO_PRICE="$IPO_PRICE" \
IPO_MAX_SHARES="$IPO_MAX_SHARES" \
IPO_STARTS_AT="$IPO_STARTS_AT" \
IPO_ENDS_AT="$IPO_ENDS_AT" \
forge script script/DeployBase.s.sol \
    --rpc-url "$BASE_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    --broadcast

BASE_ARTIFACT="$DEPLOYMENTS_DIR/base-sepolia-${TICKER}.json"
SHARE_TOKEN=$(jq -r .shareToken "$BASE_ARTIFACT")
REVENUE_VAULT=$(jq -r .revenueVault "$BASE_ARTIFACT")
IPO_SALE=$(jq -r .ipoSale "$BASE_ARTIFACT")
echo "shareToken:    $SHARE_TOKEN"
echo "revenueVault:  $REVENUE_VAULT"
echo "ipoSale:       $IPO_SALE"

# ─── Step 3: pin cross-chain pointers on the iNFT ──────────────────────
echo
echo "[3/4] setMappings on iNFT (links to Base shareToken/revenueVault + ENS)…"
cast send "$AGENT_NFT_0G" \
    "setMappings(uint256,address,address,string)" \
    "$TOKEN_ID" "$SHARE_TOKEN" "$REVENUE_VAULT" "$ENS_NAME" \
    --rpc-url "$ZG_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    "${ZG_GAS_FLAGS[@]}" \
    | grep -E '^(transactionHash|status)' || true

# ─── Step 4: register in AgentRegistry ─────────────────────────────────
echo
echo "[4/4] AgentRegistry.register on 0G…"
ENS_NAME_HASH=$(cast keccak "$ENS_NAME")
cast send "$AGENT_REGISTRY" \
    "register(uint256,address,address,bytes32)" \
    "$TOKEN_ID" "$SHARE_TOKEN" "$REVENUE_VAULT" "$ENS_NAME_HASH" \
    --rpc-url "$ZG_RPC_URL" \
    --private-key "$DEPLOYER_PRIVATE_KEY" \
    "${ZG_GAS_FLAGS[@]}" \
    | grep -E '^(transactionHash|status)' || true

echo
echo "=== hero $TICKER agent live ==="
echo "tokenId:       $TOKEN_ID"
echo "agentNft (0G): $AGENT_NFT_0G"
echo "shareToken:    $SHARE_TOKEN"
echo "revenueVault:  $REVENUE_VAULT"
echo "ipoSale:       $IPO_SALE"
echo "ensName:       $ENS_NAME"
