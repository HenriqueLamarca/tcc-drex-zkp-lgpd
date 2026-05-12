#!/usr/bin/env bash
# wait-for-besu.sh — Aguarda a rede Besu QBFT estar pronta.
# Polla eth_blockNumber em todos os 4 nos ate confirmar que estao minerando.
# Timeout: 120s.

set -e

PORTS=(8545 8546 8547 8548)
HOST=${BESU_HOST:-localhost}
TIMEOUT=${TIMEOUT:-120}
INTERVAL=2
ELAPSED=0

echo "[wait] Aguardando rede Besu (timeout: ${TIMEOUT}s)..."

check_node() {
  local port=$1
  local response
  response=$(curl -s -X POST \
    -H "Content-Type: application/json" \
    --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
    "http://${HOST}:${port}" 2>/dev/null || echo "")

  if [ -z "$response" ]; then
    echo ""
    return
  fi

  echo "$response" | grep -oP '"result":"0x[0-9a-fA-F]+"' | grep -oP '0x[0-9a-fA-F]+' || echo ""
}

while [ $ELAPSED -lt $TIMEOUT ]; do
  ALL_READY=true
  STATUSES=""

  for port in "${PORTS[@]}"; do
    BLOCK_HEX=$(check_node "$port")
    if [ -z "$BLOCK_HEX" ]; then
      STATUSES+="  port ${port}: nao responde\n"
      ALL_READY=false
    else
      BLOCK_DEC=$((16#${BLOCK_HEX#0x}))
      STATUSES+="  port ${port}: bloco ${BLOCK_DEC}\n"
      if [ "$BLOCK_DEC" -lt 1 ]; then
        ALL_READY=false
      fi
    fi
  done

  if [ "$ALL_READY" = true ]; then
    echo "[wait] Rede pronta — todos os 4 nos minerando."
    printf "%b" "$STATUSES"
    exit 0
  fi

  printf "\r[wait] %ds decorridos..." "$ELAPSED"
  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo ""
echo "[wait] TIMEOUT apos ${TIMEOUT}s. Status atual:"
printf "%b" "$STATUSES"
exit 1
