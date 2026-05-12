#!/bin/sh
# init.sh — Gera arquivos de rede QBFT (genesis + chaves de validadores).
# Executado uma única vez pelo service besu-init no docker-compose.
# Idempotente: se networkFiles/ já estiver populado, sai sem refazer.

set -e

OUT_DIR=/networkFiles
TMP_DIR=/tmp/qbft-out
CONFIG_FILE=/qbftConfigFile.json

if [ -f "$OUT_DIR/genesis.json" ] && [ -f "$OUT_DIR/bootnodes.txt" ]; then
  echo "[init] Rede ja inicializada em $OUT_DIR — pulando geracao."
  exit 0
fi

echo "[init] Gerando configuracao QBFT (4 validadores)..."
rm -rf "$TMP_DIR"
mkdir -p "$TMP_DIR"

besu operator generate-blockchain-config \
  --config-file="$CONFIG_FILE" \
  --to="$TMP_DIR" \
  --private-key-file-name=key

# Move o genesis.json para a saida final
mkdir -p "$OUT_DIR"
cp "$TMP_DIR/genesis.json" "$OUT_DIR/genesis.json"
echo "[init] genesis.json gerado."

# Reorganiza chaves: keys/<address>/key  ->  keys/node-N/key
i=1
ENODES=""
for d in "$TMP_DIR"/keys/*/; do
  NODE_DIR="$OUT_DIR/keys/node-$i"
  mkdir -p "$NODE_DIR"
  cp "$d/key" "$NODE_DIR/key"
  cp "$d/key.pub" "$NODE_DIR/key.pub"

  # Endereco derivado (nome do diretorio original) — gravado para auditoria
  ADDR=$(basename "$d")
  echo "$ADDR" > "$NODE_DIR/address"

  # Chave publica para enode URL (remove prefixo 0x)
  PUBKEY=$(cat "$d/key.pub" | sed 's/^0x//')
  ENODE="enode://${PUBKEY}@node-${i}:30303"

  if [ -z "$ENODES" ]; then
    ENODES="$ENODE"
  else
    ENODES="${ENODES},${ENODE}"
  fi

  echo "[init] node-$i: $ADDR"
  i=$((i + 1))
done

# Lista de bootnodes consumida pelos validadores via start-node.sh
echo "$ENODES" > "$OUT_DIR/bootnodes.txt"
echo "[init] bootnodes.txt gravado com $((i - 1)) enodes."

# Permissoes abertas para os volumes compartilhados (rede de teste apenas)
chmod -R a+rX "$OUT_DIR"

echo "[init] Concluido."
