#!/usr/bin/env bash
# =============================================================================
# 01_setup_zkp.sh — Pipeline ZoKrates completo via Docker.
#
# Etapas:
#   1. Compila circuits/solvency_dvp.zok
#   2. Executa trusted setup Groth16 (local — limitacoes em ADR-0003)
#   3. Exporta contracts/Verifier.sol consumido pelo DvPSettlement
#
# Pre-requisitos: Docker rodando. Rust/ZoKrates NAO sao necessarios no host.
# Idempotente: re-rodar regenera todos os artefatos.
# =============================================================================

set -euo pipefail

ZOKRATES_IMAGE="zokrates/zokrates:0.8.8"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

# Workaround Git Bash no Windows — impede traducao automatica de paths POSIX
export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

echo "[zkp] ============================================================"
echo "[zkp] Setup ZoKrates 0.8.8 (Groth16 / BN128)"
echo "[zkp] Diretorio: ${PROJECT_DIR}"
echo "[zkp] ============================================================"

# -----------------------------------------------------------------------------
# Verifica Docker
# -----------------------------------------------------------------------------
if ! docker info >/dev/null 2>&1; then
    echo "[zkp] ERRO: Docker nao esta rodando. Inicie o Docker Desktop e tente novamente." >&2
    exit 1
fi

# -----------------------------------------------------------------------------
# Garante diretorios de saida
# -----------------------------------------------------------------------------
mkdir -p "${PROJECT_DIR}/circuits/proving_key"
mkdir -p "${PROJECT_DIR}/contracts"

# -----------------------------------------------------------------------------
# Executa todas as etapas em um unico container (mais rapido que 3 docker run)
# -----------------------------------------------------------------------------
echo "[zkp] Executando pipeline (compile + setup + export-verifier)..."

docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    bash -c '
        set -e

        echo "[zokrates] 1/3 Compilando solvency_dvp.zok..."
        zokrates compile \
            -i circuits/solvency_dvp.zok \
            -o circuits/proving_key/out \
            --abi-spec circuits/proving_key/abi.json \
            -s circuits/proving_key/inspect.json 2>/dev/null || \
        zokrates compile \
            -i circuits/solvency_dvp.zok \
            -o circuits/proving_key/out \
            --abi-spec circuits/proving_key/abi.json

        echo "[zokrates] 2/3 Trusted setup Groth16..."
        zokrates setup \
            -i circuits/proving_key/out \
            -p circuits/proving_key/proving.key \
            -v circuits/proving_key/verification.key \
            --backend ark \
            --proving-scheme g16

        echo "[zokrates] 3/3 Exportando Verifier.sol..."
        zokrates export-verifier \
            -i circuits/proving_key/verification.key \
            -o contracts/Verifier.sol

        echo "[zokrates] Artefatos gerados:"
        ls -lh circuits/proving_key/ contracts/Verifier.sol
    '

# -----------------------------------------------------------------------------
# Resumo
# -----------------------------------------------------------------------------
echo "[zkp] ============================================================"
echo "[zkp] Setup concluido."
echo "[zkp]   Circuito compilado: circuits/proving_key/out"
echo "[zkp]   Proving key:        circuits/proving_key/proving.key"
echo "[zkp]   Verification key:   circuits/proving_key/verification.key"
echo "[zkp]   Verifier.sol:       contracts/Verifier.sol"
echo "[zkp] ============================================================"
echo "[zkp] AVISO: trusted setup local — NAO usar em producao."
echo "[zkp]        Detalhes em docs/ADR/0003-trusted-setup-handling.md"
echo "[zkp] ============================================================"
