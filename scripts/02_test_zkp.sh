#!/usr/bin/env bash
# =============================================================================
# 02_test_zkp.sh — Smoke test do circuito solvency_dvp.zok.
#
# Cenarios:
#   T1 — entrada valida (S_A=100, V=30, S_B=50): compute-witness + proof OK
#   T2 — saldo insuficiente (S_A=10, V=20): compute-witness DEVE falhar
#         (LGPD art. 6º III — necessidade: pagamento sem solvencia recusado)
#   T3 — valor zero (V=0): compute-witness DEVE falhar
#         (LGPD art. 6º III — necessidade: operacao sem proposito recusada)
#
# Uso de commit_helper.zok para precomputar commitments Poseidon compativeis
# com o circuito principal — evita dependencias JS off-chain.
# =============================================================================

set -euo pipefail

ZOKRATES_IMAGE="zokrates/zokrates:0.8.8"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# Inputs validos (T1)
S_A=100
S_B=50
V=30
R_A_OLD=11111
R_B_OLD=22222
R_A_NEW=33333
R_B_NEW=44444

S_A_NEW=$((S_A - V))   # 70
S_B_NEW=$((S_B + V))   # 80

echo "[test] ============================================================"
echo "[test] Smoke test do circuito solvency_dvp.zok"
echo "[test] ============================================================"

# -----------------------------------------------------------------------------
# Compila o helper uma vez
# -----------------------------------------------------------------------------
echo "[test] Compilando commit_helper.zok..."
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    zokrates compile \
        -i circuits/commit_helper.zok \
        -o circuits/proving_key/helper_out \
        --abi-spec circuits/proving_key/helper_abi.json \
        >/dev/null

# -----------------------------------------------------------------------------
# Calcula um commit(value, randomness) usando o helper
# Argumentos: $1=value $2=randomness
# Saida: imprime o commit no stdout (numero decimal grande)
# -----------------------------------------------------------------------------
compute_commit() {
    local value=$1
    local rand=$2
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        bash -c "
            zokrates compute-witness --json \
                -i circuits/proving_key/helper_out \
                -a $value $rand \
                -o /tmp/helper_witness >/dev/null 2>&1
            cat /tmp/helper_witness.json | grep -oE '\"~out_0\":[[:space:]]*\"[0-9]+\"' | grep -oE '[0-9]+' | tail -n 1
        "
}

echo "[test] Precomputando commitments via Poseidon..."
COMMIT_A_OLD=$(compute_commit "$S_A"     "$R_A_OLD")
COMMIT_B_OLD=$(compute_commit "$S_B"     "$R_B_OLD")
COMMIT_A_NEW=$(compute_commit "$S_A_NEW" "$R_A_NEW")
COMMIT_B_NEW=$(compute_commit "$S_B_NEW" "$R_B_NEW")

echo "[test]   commit_A_old = ${COMMIT_A_OLD}"
echo "[test]   commit_B_old = ${COMMIT_B_OLD}"
echo "[test]   commit_A_new = ${COMMIT_A_NEW}"
echo "[test]   commit_B_new = ${COMMIT_B_NEW}"

if [ -z "$COMMIT_A_OLD" ] || [ -z "$COMMIT_B_OLD" ] || [ -z "$COMMIT_A_NEW" ] || [ -z "$COMMIT_B_NEW" ]; then
    echo "[test] ERRO: nao foi possivel extrair commitments via helper." >&2
    exit 1
fi

# -----------------------------------------------------------------------------
# T1 — entrada valida
# -----------------------------------------------------------------------------
echo ""
echo "[test] [T1] Entrada valida (S_A=$S_A V=$V S_B=$S_B) — esperando SUCESSO..."

T1_OK=true
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    zokrates compute-witness \
        -i circuits/proving_key/out \
        -a "$COMMIT_A_OLD" "$COMMIT_B_OLD" "$COMMIT_A_NEW" "$COMMIT_B_NEW" \
           "$S_A" "$S_B" "$V" "$R_A_OLD" "$R_B_OLD" "$R_A_NEW" "$R_B_NEW" \
        -o circuits/proving_key/witness >/dev/null 2>&1 || T1_OK=false

if [ "$T1_OK" = true ]; then
    echo "[test] [T1] OK — witness gerado."

    echo "[test] [T1] Gerando proof Groth16..."
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        zokrates generate-proof \
            -i circuits/proving_key/out \
            -w circuits/proving_key/witness \
            -p circuits/proving_key/proving.key \
            -j circuits/proving_key/proof.json \
            --backend ark \
            --proving-scheme g16 >/dev/null

    echo "[test] [T1] Verificando proof off-chain..."
    if docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        zokrates verify \
            -v circuits/proving_key/verification.key \
            -j circuits/proving_key/proof.json \
            --backend ark 2>&1 | grep -q "PASSED"; then
        echo "[test] [T1] PASS — proof valida verificada com sucesso."
    else
        echo "[test] [T1] FALHA — proof gerada mas verificacao falhou." >&2
        exit 1
    fi
else
    echo "[test] [T1] FALHA — compute-witness falhou para entrada valida." >&2
    exit 1
fi

# -----------------------------------------------------------------------------
# T2 — saldo insuficiente (S_A < V)
# -----------------------------------------------------------------------------
echo ""
echo "[test] [T2] Saldo insuficiente (S_A=10 V=20) — esperando FALHA..."

BAD_S_A=10
BAD_V=20
BAD_S_A_NEW=0
BAD_S_B_NEW=$((S_B + BAD_V))

BAD_COMMIT_A_OLD=$(compute_commit "$BAD_S_A"     "$R_A_OLD")
BAD_COMMIT_A_NEW=$(compute_commit "$BAD_S_A_NEW" "$R_A_NEW")
BAD_COMMIT_B_NEW=$(compute_commit "$BAD_S_B_NEW" "$R_B_NEW")

T2_FAILED=false
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    zokrates compute-witness \
        -i circuits/proving_key/out \
        -a "$BAD_COMMIT_A_OLD" "$COMMIT_B_OLD" "$BAD_COMMIT_A_NEW" "$BAD_COMMIT_B_NEW" \
           "$BAD_S_A" "$S_B" "$BAD_V" "$R_A_OLD" "$R_B_OLD" "$R_A_NEW" "$R_B_NEW" \
        -o /tmp/witness_t2 >/dev/null 2>&1 || T2_FAILED=true

if [ "$T2_FAILED" = true ]; then
    echo "[test] [T2] PASS — circuito rejeitou (S_A < V conforme esperado)."
else
    echo "[test] [T2] FALHA — circuito aceitou entrada invalida (S_A=10 < V=20)." >&2
    exit 1
fi

# -----------------------------------------------------------------------------
# T3 — valor zero
# -----------------------------------------------------------------------------
echo ""
echo "[test] [T3] Valor zero (V=0) — esperando FALHA..."

ZERO_V=0
ZERO_S_A_NEW=$S_A
ZERO_S_B_NEW=$S_B
ZERO_COMMIT_A_NEW=$(compute_commit "$ZERO_S_A_NEW" "$R_A_NEW")
ZERO_COMMIT_B_NEW=$(compute_commit "$ZERO_S_B_NEW" "$R_B_NEW")

T3_FAILED=false
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    zokrates compute-witness \
        -i circuits/proving_key/out \
        -a "$COMMIT_A_OLD" "$COMMIT_B_OLD" "$ZERO_COMMIT_A_NEW" "$ZERO_COMMIT_B_NEW" \
           "$S_A" "$S_B" "$ZERO_V" "$R_A_OLD" "$R_B_OLD" "$R_A_NEW" "$R_B_NEW" \
        -o /tmp/witness_t3 >/dev/null 2>&1 || T3_FAILED=true

if [ "$T3_FAILED" = true ]; then
    echo "[test] [T3] PASS — circuito rejeitou (V == 0 conforme esperado)."
else
    echo "[test] [T3] FALHA — circuito aceitou V=0." >&2
    exit 1
fi

echo ""
echo "[test] ============================================================"
echo "[test] Smoke test COMPLETO — 3/3 cenarios passaram."
echo "[test] ============================================================"
