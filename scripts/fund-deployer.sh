#!/usr/bin/env bash
# Send 0.08 ETH on Base Sepolia from a funded wallet to the Stratum deployer.
# Usage:
#   scripts/fund-deployer.sh --key 0x<private-key>
# Or:
#   FUNDER_PK=0x... scripts/fund-deployer.sh

set -euo pipefail

RECIPIENT="0x2908209845Edd4B526B9F26E3b3bba73E9A59D10"
AMOUNT_ETH="0.08"
EXPECTED_CHAIN_ID="84532"

# Public Base Sepolia RPCs, tried in order. sepolia.base.org goes 502 often.
RPC_CANDIDATES=(
  "https://base-sepolia-rpc.publicnode.com"
  "https://base-sepolia.gateway.tenderly.co"
  "https://1rpc.io/base-sepolia"
  "https://sepolia.base.org"
)

PK="${FUNDER_PK:-}"
RPC_OVERRIDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --key)    PK="$2"; shift 2 ;;
    --key=*)  PK="${1#*=}"; shift ;;
    --rpc)    RPC_OVERRIDE="$2"; shift 2 ;;
    --rpc=*)  RPC_OVERRIDE="${1#*=}"; shift ;;
    -h|--help)
      echo "usage: $0 --key <0x-prefixed-private-key> [--rpc <url>]"
      echo "       FUNDER_PK=0x... $0"
      exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 1 ;;
  esac
done

if [[ -n "$RPC_OVERRIDE" ]]; then
  RPC_CANDIDATES=("$RPC_OVERRIDE")
fi

# Pick first RPC that returns the expected chain id.
RPC=""
for candidate in "${RPC_CANDIDATES[@]}"; do
  echo "trying RPC: $candidate"
  if cid=$(cast chain-id --rpc-url "$candidate" 2>/dev/null) && [[ "$cid" == "$EXPECTED_CHAIN_ID" ]]; then
    RPC="$candidate"
    echo "  ✓ live (chain $cid)"
    break
  fi
  echo "  ✗ unreachable"
done

if [[ -z "$RPC" ]]; then
  echo "error: no Base Sepolia RPC reachable. Try --rpc <your-own-url>." >&2
  exit 1
fi

if [[ -z "$PK" ]]; then
  echo "error: missing private key. Pass --key 0x... or set FUNDER_PK." >&2
  exit 1
fi
[[ "$PK" == 0x* ]] || PK="0x$PK"

FROM=$(cast wallet address --private-key "$PK")
BAL_WEI=$(cast balance "$FROM" --rpc-url "$RPC")
BAL_ETH=$(cast from-wei "$BAL_WEI")

echo
echo "network:   Base Sepolia (chain $EXPECTED_CHAIN_ID via $RPC)"
echo "from:      $FROM"
echo "balance:   $BAL_ETH ETH"
echo "to:        $RECIPIENT"
echo "amount:    $AMOUNT_ETH ETH"
echo

cast send "$RECIPIENT" \
  --value "${AMOUNT_ETH}ether" \
  --rpc-url "$RPC" \
  --private-key "$PK"

echo
echo "recipient new balance: $(cast from-wei "$(cast balance "$RECIPIENT" --rpc-url "$RPC")") ETH"
