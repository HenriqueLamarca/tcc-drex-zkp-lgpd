#!/bin/sh
# start-node.sh — Entrypoint para cada validador Besu QBFT.
# Uso: start-node.sh <NODE_NAME>  (ex.: start-node.sh node-1)
# Le bootnodes.txt + chave do no a partir do volume compartilhado /networkFiles
# (preenchido previamente pelo service besu-init via init.sh).
# Resolve hostnames node-N para IPs antes de passar ao Besu (besu nao aceita
# hostnames em enode URLs, apenas IPs).

set -e

NODE_NAME="$1"
if [ -z "$NODE_NAME" ]; then
  echo "[start] ERRO: NODE_NAME nao informado." >&2
  exit 1
fi

NETWORK_DIR=/networkFiles
GENESIS="$NETWORK_DIR/genesis.json"
KEY_FILE="$NETWORK_DIR/keys/$NODE_NAME/key"
BOOTNODES_FILE="$NETWORK_DIR/bootnodes.txt"
DATA_PATH=/data

# Espera ate o init terminar (race condition durante startup)
WAIT=0
while [ ! -f "$BOOTNODES_FILE" ] || [ ! -f "$GENESIS" ] || [ ! -f "$KEY_FILE" ]; do
  if [ $WAIT -ge 30 ]; then
    echo "[start] ERRO: arquivos de rede nao encontrados apos 30s." >&2
    echo "[start]   GENESIS=$GENESIS  KEY=$KEY_FILE  BOOTNODES=$BOOTNODES_FILE" >&2
    exit 1
  fi
  echo "[start] $NODE_NAME aguardando arquivos do init... (${WAIT}s)"
  sleep 1
  WAIT=$((WAIT + 1))
done

RAW_BOOTNODES=$(cat "$BOOTNODES_FILE")

# Resolver hostnames node-N -> IPs (Besu rejeita hostnames em enode URLs)
RESOLVED_BOOTNODES=""
OLD_IFS=$IFS
IFS=','
for enode in $RAW_BOOTNODES; do
  HOSTNAME=$(echo "$enode" | sed -E 's|.*@([^:]+):.*|\1|')
  IP=$(getent hosts "$HOSTNAME" | awk '{print $1}' | head -n1)
  if [ -z "$IP" ]; then
    echo "[start] AVISO: nao foi possivel resolver $HOSTNAME — pulando" >&2
    continue
  fi
  RESOLVED=$(echo "$enode" | sed "s|@${HOSTNAME}:|@${IP}:|")
  if [ -z "$RESOLVED_BOOTNODES" ]; then
    RESOLVED_BOOTNODES="$RESOLVED"
  else
    RESOLVED_BOOTNODES="${RESOLVED_BOOTNODES},${RESOLVED}"
  fi
done
IFS=$OLD_IFS

echo "[start] $NODE_NAME iniciando."
echo "[start]   genesis: $GENESIS"
echo "[start]   key:     $KEY_FILE"
echo "[start]   bootnodes (resolvidos): $RESOLVED_BOOTNODES"

exec besu \
  --data-path="$DATA_PATH" \
  --genesis-file="$GENESIS" \
  --node-private-key-file="$KEY_FILE" \
  --bootnodes="$RESOLVED_BOOTNODES" \
  --p2p-host=0.0.0.0 \
  --p2p-port=30303 \
  --rpc-http-enabled \
  --rpc-http-host=0.0.0.0 \
  --rpc-http-port=8545 \
  --rpc-http-cors-origins=all \
  --rpc-http-api=ETH,NET,QBFT,WEB3,ADMIN,DEBUG,TXPOOL \
  --host-allowlist=* \
  --min-gas-price=0 \
  --logging=INFO
