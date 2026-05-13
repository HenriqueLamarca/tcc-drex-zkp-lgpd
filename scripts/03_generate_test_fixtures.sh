#!/usr/bin/env bash
# =============================================================================
# 03_generate_test_fixtures.sh
#
# Gera fixtures determinísticas para os testes unitários de DvPSettlement:
#   - test/fixtures/valid-proof.json   (proof Groth16 + 4 inputs publicos)
#   - test/fixtures/witness-data.json  (saldos, valor, randomness — apenas off-chain)
#
# Mesmo cenario do smoke test T1: S_A=100, V=30, S_B=50, randomness fixa.
# Permite que os testes Hardhat reutilizem a mesma prova sem regerar a cada run.
# =============================================================================

set -euo pipefail

ZOKRATES_IMAGE="zokrates/zokrates:0.8.8"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
FIXTURES_DIR="${PROJECT_DIR}/test/fixtures"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

mkdir -p "$FIXTURES_DIR"

# ─── Cenario T1 (igual ao smoke test) ────────────────────────────────────────
S_A=100
S_B=50
V=30
R_A_OLD=11111
R_B_OLD=22222
R_A_NEW=33333
R_B_NEW=44444
S_A_NEW=$((S_A - V))   # 70
S_B_NEW=$((S_B + V))   # 80

echo "[fix] Gerando fixtures de teste (T1 valido)..."

# ─── Compila helper se necessario ────────────────────────────────────────────
if [ ! -f "${PROJECT_DIR}/circuits/proving_key/helper_out" ]; then
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        zokrates compile \
            -i circuits/commit_helper.zok \
            -o circuits/proving_key/helper_out \
            --abi-spec circuits/proving_key/helper_abi.json >/dev/null
fi

# ─── Calcula commitment via helper ───────────────────────────────────────────
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

COMMIT_A_OLD=$(compute_commit "$S_A"     "$R_A_OLD")
COMMIT_B_OLD=$(compute_commit "$S_B"     "$R_B_OLD")
COMMIT_A_NEW=$(compute_commit "$S_A_NEW" "$R_A_NEW")
COMMIT_B_NEW=$(compute_commit "$S_B_NEW" "$R_B_NEW")

echo "[fix]   commit_A_old = $COMMIT_A_OLD"
echo "[fix]   commit_B_old = $COMMIT_B_OLD"
echo "[fix]   commit_A_new = $COMMIT_A_NEW"
echo "[fix]   commit_B_new = $COMMIT_B_NEW"

# ─── Gera witness + proof do circuito principal ──────────────────────────────
echo "[fix] Gerando proof Groth16..."
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    bash -c "
        zokrates compute-witness \
            -i circuits/proving_key/out \
            -a $COMMIT_A_OLD $COMMIT_B_OLD $COMMIT_A_NEW $COMMIT_B_NEW \
               $S_A $S_B $V $R_A_OLD $R_B_OLD $R_A_NEW $R_B_NEW \
            -o circuits/proving_key/witness >/dev/null

        zokrates generate-proof \
            -i circuits/proving_key/out \
            -w circuits/proving_key/witness \
            -p circuits/proving_key/proving.key \
            -j circuits/proving_key/proof.json >/dev/null
    "

# ─── Copia proof.json para fixtures e adiciona metadados ─────────────────────
cp "${PROJECT_DIR}/circuits/proving_key/proof.json" "${FIXTURES_DIR}/valid-proof.json"

cat > "${FIXTURES_DIR}/witness-data.json" <<EOF
{
  "_comment": "Dados privados de witness para reproducibilidade dos testes. NAO deve aparecer em producao.",
  "scenario": "T1_valid",
  "private_inputs": {
    "S_A": "$S_A",
    "S_B": "$S_B",
    "V": "$V",
    "r_A_old": "$R_A_OLD",
    "r_B_old": "$R_B_OLD",
    "r_A_new": "$R_A_NEW",
    "r_B_new": "$R_B_NEW",
    "S_A_new": "$S_A_NEW",
    "S_B_new": "$S_B_NEW"
  },
  "public_inputs": {
    "commit_A_old": "$COMMIT_A_OLD",
    "commit_B_old": "$COMMIT_B_OLD",
    "commit_A_new": "$COMMIT_A_NEW",
    "commit_B_new": "$COMMIT_B_NEW"
  }
}
EOF

echo "[fix] Fixtures escritas em:"
echo "[fix]   ${FIXTURES_DIR}/valid-proof.json"
echo "[fix]   ${FIXTURES_DIR}/witness-data.json"
echo "[fix] Concluido."
