#!/usr/bin/env bash
# =============================================================================
# property_test_circuit.sh - Property-based testing do circuito solvency_dvp.zok.
#
# Diferente do smoke test (02_test_zkp.sh) que valida 3 cenarios fixos, este
# script gera N cenarios pseudo-aleatorios em duas categorias:
#
#   VALIDOS:   inputs que devem ser ACEITOS pelo circuito
#              (V > 0, S_A >= V, commits coerentes)
#   INVALIDOS: inputs que devem ser REJEITADOS pelo circuito
#              (V == 0, V > S_A, commit antigo adulterado, conservacao
#              violada, randomness incorreta)
#
# Reporta a proporcao de pass/fail e lista quaisquer contra-exemplos
# (cenarios validos rejeitados ou cenarios invalidos aceitos).
#
# Configuracao:
#   ITER_VALID         - numero de cenarios validos a testar (default: 30)
#   ITER_INVALID       - numero de cenarios invalidos a testar (default: 30)
#   RNG_SEED           - seed para reproducibilidade (default: 1)
#   MAX_VALUE          - limite superior dos saldos/valores (default: 1000000)
#
# Uso:
#   bash scripts/property_test_circuit.sh
#   ITER_VALID=100 ITER_INVALID=100 bash scripts/property_test_circuit.sh
# =============================================================================

set -uo pipefail

ZOKRATES_IMAGE="zokrates/zokrates:0.8.8"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

ITER_VALID="${ITER_VALID:-30}"
ITER_INVALID="${ITER_INVALID:-30}"
RNG_SEED="${RNG_SEED:-1}"
MAX_VALUE="${MAX_VALUE:-1000000}"

# RNG simples + deterministico baseado em seed (xorshift)
__rng_state=$RNG_SEED
rand() {
    # Retorna inteiro em [1, $1] (parametro = limite superior, exclusivo)
    local limit=$1
    __rng_state=$(( (__rng_state * 1103515245 + 12345) % 2147483648 ))
    echo $(( (__rng_state % (limit - 1)) + 1 ))
}

results_dir="${PROJECT_DIR}/benchmark/results"
mkdir -p "$results_dir"
report="${results_dir}/property_test_report.txt"

echo "[property] ============================================================"
echo "[property] Property-based testing do circuito solvency_dvp"
echo "[property] Cenarios validos:   $ITER_VALID"
echo "[property] Cenarios invalidos: $ITER_INVALID"
echo "[property] RNG seed:           $RNG_SEED"
echo "[property] Maximo de valores:  $MAX_VALUE"
echo "[property] ============================================================"

# ─── Compila o helper se nao existir ────────────────────────────────────────
if [ ! -f "${PROJECT_DIR}/circuits/proving_key/helper_out" ]; then
    echo "[property] Compilando commit_helper.zok..."
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

# ─── Calcula Poseidon(v, r) via helper ──────────────────────────────────────
compute_commit() {
    local value=$1
    local rand_val=$2
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        bash -c "
            zokrates compute-witness --json \
                -i circuits/proving_key/helper_out \
                -a $value $rand_val \
                -o /tmp/helper_witness >/dev/null 2>&1
            cat /tmp/helper_witness.json | grep -oE '\"~out_0\":[[:space:]]*\"[0-9]+\"' | grep -oE '[0-9]+' | tail -n 1
        "
}

# ─── Testa um cenario no circuito principal ─────────────────────────────────
# Args: commit_A_old commit_B_old commit_A_new commit_B_new S_A S_B V r_A_old r_B_old r_A_new r_B_new
# Retorna 0 se compute-witness teve sucesso, !=0 caso contrario
run_main_circuit() {
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        zokrates compute-witness \
            -i circuits/proving_key/out \
            -a "$@" \
            -o /tmp/witness_property >/dev/null 2>&1
}

# ─── Cenarios validos ───────────────────────────────────────────────────────
valid_accepted=0
valid_rejected=0
counter_examples_valid=()

echo ""
echo "[property] Rodando $ITER_VALID cenarios VALIDOS (esperado: 100% aceitos)..."

for i in $(seq 1 "$ITER_VALID"); do
    s_a=$(rand "$MAX_VALUE")
    # garantir s_a >= 2 para haver V valido
    if [ "$s_a" -lt 2 ]; then s_a=2; fi
    v=$(rand "$s_a")  # V em [1, s_a]
    s_b=$(rand "$MAX_VALUE")
    r_a_old=$(rand 2147483647)
    r_b_old=$(rand 2147483647)
    r_a_new=$(rand 2147483647)
    r_b_new=$(rand 2147483647)
    s_a_new=$((s_a - v))
    s_b_new=$((s_b + v))

    c_a_old=$(compute_commit "$s_a"     "$r_a_old")
    c_b_old=$(compute_commit "$s_b"     "$r_b_old")
    c_a_new=$(compute_commit "$s_a_new" "$r_a_new")
    c_b_new=$(compute_commit "$s_b_new" "$r_b_new")

    if run_main_circuit "$c_a_old" "$c_b_old" "$c_a_new" "$c_b_new" \
                       "$s_a" "$s_b" "$v" "$r_a_old" "$r_b_old" "$r_a_new" "$r_b_new"; then
        valid_accepted=$((valid_accepted + 1))
        printf "\r[property] validos: %d/%d aceitos" "$valid_accepted" "$i"
    else
        valid_rejected=$((valid_rejected + 1))
        counter_examples_valid+=("S_A=$s_a V=$v S_B=$s_b r=$r_a_old,$r_b_old,$r_a_new,$r_b_new")
        echo ""
        echo "[property] CONTRA-EXEMPLO VALIDO REJEITADO: S_A=$s_a V=$v S_B=$s_b" >&2
    fi
done
echo ""

# ─── Cenarios invalidos ─────────────────────────────────────────────────────
invalid_rejected=0
invalid_accepted=0
counter_examples_invalid=()

echo ""
echo "[property] Rodando $ITER_INVALID cenarios INVALIDOS (esperado: 100% rejeitados)..."

# Estrategias de "invalidacao":
#   0: V = 0
#   1: V > S_A (insolvencia)
#   2: commit_A_old adulterado (nao bate com S_A, r_A_old)
#   3: conservacao violada (S_A_new != S_A - V)
#   4: randomness do novo commit "errada" (commit_A_new nao bate)

for i in $(seq 1 "$ITER_INVALID"); do
    strategy=$(($(rand 5) - 1))
    s_a=$(rand "$MAX_VALUE")
    if [ "$s_a" -lt 2 ]; then s_a=2; fi
    s_b=$(rand "$MAX_VALUE")
    r_a_old=$(rand 2147483647)
    r_b_old=$(rand 2147483647)
    r_a_new=$(rand 2147483647)
    r_b_new=$(rand 2147483647)

    case "$strategy" in
      0) # V = 0
         v=0
         s_a_new=$s_a
         s_b_new=$s_b
         c_a_old=$(compute_commit "$s_a"     "$r_a_old")
         c_b_old=$(compute_commit "$s_b"     "$r_b_old")
         c_a_new=$(compute_commit "$s_a_new" "$r_a_new")
         c_b_new=$(compute_commit "$s_b_new" "$r_b_new")
         desc="V=0"
         ;;
      1) # V > S_A
         v=$((s_a + $(rand 100)))
         s_a_new=0
         s_b_new=$((s_b + v))
         c_a_old=$(compute_commit "$s_a"     "$r_a_old")
         c_b_old=$(compute_commit "$s_b"     "$r_b_old")
         c_a_new=$(compute_commit "$s_a_new" "$r_a_new")
         c_b_new=$(compute_commit "$s_b_new" "$r_b_new")
         desc="V>S_A (S_A=$s_a, V=$v)"
         ;;
      2) # commit_A_old adulterado
         v=$(rand "$s_a")
         s_a_new=$((s_a - v))
         s_b_new=$((s_b + v))
         c_a_old=$(compute_commit $((s_a + 1)) "$r_a_old")  # tampered
         c_b_old=$(compute_commit "$s_b"       "$r_b_old")
         c_a_new=$(compute_commit "$s_a_new"   "$r_a_new")
         c_b_new=$(compute_commit "$s_b_new"   "$r_b_new")
         desc="commit_A_old tampered"
         ;;
      3) # conservacao violada
         v=$(rand "$s_a")
         s_a_new=$((s_a - v))
         s_b_new=$((s_b + v + $(rand 50)))  # Bob "ganhou" valor a mais
         c_a_old=$(compute_commit "$s_a"     "$r_a_old")
         c_b_old=$(compute_commit "$s_b"     "$r_b_old")
         c_a_new=$(compute_commit "$s_a_new" "$r_a_new")
         c_b_new=$(compute_commit "$s_b_new" "$r_b_new")
         desc="conservacao violada (Bob ganhou extra)"
         ;;
      *) # 4: commit_A_new com randomness errada
         v=$(rand "$s_a")
         s_a_new=$((s_a - v))
         s_b_new=$((s_b + v))
         c_a_old=$(compute_commit "$s_a"     "$r_a_old")
         c_b_old=$(compute_commit "$s_b"     "$r_b_old")
         c_a_new=$(compute_commit "$s_a_new" $((r_a_new + 1)))  # randomness diferente
         c_b_new=$(compute_commit "$s_b_new" "$r_b_new")
         desc="commit_A_new com randomness diferente do witness"
         ;;
    esac

    if run_main_circuit "$c_a_old" "$c_b_old" "$c_a_new" "$c_b_new" \
                       "$s_a" "$s_b" "$v" "$r_a_old" "$r_b_old" "$r_a_new" "$r_b_new"; then
        invalid_accepted=$((invalid_accepted + 1))
        counter_examples_invalid+=("$desc")
        echo ""
        echo "[property] CONTRA-EXEMPLO INVALIDO ACEITO: $desc" >&2
    else
        invalid_rejected=$((invalid_rejected + 1))
        printf "\r[property] invalidos: %d/%d rejeitados" "$invalid_rejected" "$i"
    fi
done
echo ""

# ─── Relatorio ──────────────────────────────────────────────────────────────
{
echo "# Property-based test report"
echo "# Generated: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "# Circuit:   circuits/solvency_dvp.zok"
echo "# RNG seed:  $RNG_SEED"
echo ""
echo "Cenarios validos:"
echo "  testados:  $ITER_VALID"
echo "  aceitos:   $valid_accepted ($((valid_accepted * 100 / ITER_VALID))%)"
echo "  rejeitados: $valid_rejected (contra-exemplos esperados ser zero)"
echo ""
echo "Cenarios invalidos:"
echo "  testados:    $ITER_INVALID"
echo "  rejeitados:  $invalid_rejected ($((invalid_rejected * 100 / ITER_INVALID))%)"
echo "  aceitos:     $invalid_accepted (contra-exemplos esperados ser zero)"
echo ""
if [ "${#counter_examples_valid[@]}" -gt 0 ]; then
    echo "Contra-exemplos (validos rejeitados — FALHA do circuito):"
    for ce in "${counter_examples_valid[@]}"; do
        echo "  - $ce"
    done
    echo ""
fi
if [ "${#counter_examples_invalid[@]}" -gt 0 ]; then
    echo "Contra-exemplos (invalidos aceitos — FALHA do circuito, GRAVE):"
    for ce in "${counter_examples_invalid[@]}"; do
        echo "  - $ce"
    done
    echo ""
fi
echo "Veredito:"
if [ "$valid_rejected" -eq 0 ] && [ "$invalid_accepted" -eq 0 ]; then
    echo "  OK  — nenhum contra-exemplo em $((ITER_VALID + ITER_INVALID)) cenarios."
else
    echo "  FALHA — ver contra-exemplos acima."
fi
} | tee "$report"

echo ""
echo "[property] Relatorio salvo em: $report"

if [ "$valid_rejected" -ne 0 ] || [ "$invalid_accepted" -ne 0 ]; then
    exit 1
fi
