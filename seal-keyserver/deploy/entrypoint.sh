#!/usr/bin/env bash
# Generate the key-server config from env at startup, then run. The key-server
# reads PORT from env (Railway injects it) and serves /health on it.
set -euo pipefail

: "${MASTER_KEY:?set MASTER_KEY (BLS master secret from seal-cli genkey)}"
: "${KEY_SERVER_OBJECT_ID:?set KEY_SERVER_OBJECT_ID (from register-key-server.ts)}"
NETWORK="${SEAL_KS_NETWORK:-Mainnet}"
NODE_URL="${SEAL_KS_NODE_URL:-https://fullnode.mainnet.sui.io:443}"

cat > /tmp/key-server-config.yaml <<YAML
network: ${NETWORK}
node_url: ${NODE_URL}
server_mode: !Open
  key_server_object_id: '${KEY_SERVER_OBJECT_ID}'
YAML

export CONFIG_PATH=/tmp/key-server-config.yaml
echo "[entrypoint] network=${NETWORK} key_server_object_id=${KEY_SERVER_OBJECT_ID} port=${PORT:-2024}"
exec key-server
