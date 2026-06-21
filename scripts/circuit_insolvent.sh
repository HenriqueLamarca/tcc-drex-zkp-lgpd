#!/usr/bin/env bash
# =============================================================================
# circuit_insolvent.sh - Demonstra que o CIRCUITO recusa uma transferencia
# insolvente: a prova nem chega a ser gerada.
#
# Diferenca para a "liquidacao invalida" (06_run_dvp_demo_fail.ts): la, uma
# prova ADULTERADA e' submetida e barrada ON-CHAIN pelo Verifier. Aqui a
# barreira e' ANTERIOR e criptografica: o proprio ZoKrates nao consegue computar
# o witness, pois o predicado assert(S_A >= V) do circuito e' violado. Nao ha
# prova alguma a apresentar.
#
# Cenario: Henrique tem 100, tenta enviar 150 (V > saldo).
# Resultado ESPERADO: compute-witness FALHA (recusa do circuito) -> SUCESSO da
# demonstracao de seguranca (escreve o sentinela .make_step.ok). Se, ao
# contrario, o circuito ACEITAR (nunca deveria), e' falha real (sem sentinela).
# =============================================================================
set -uo pipefail

ZOKRATES_IMAGE="zokrates/zokrates:0.8.8"
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"
SENTINEL="$PROJECT_DIR/.make_step.ok"

export MSYS_NO_PATHCONV=1
export MSYS2_ARG_CONV_EXCL="*"

# Cenario insolvente (saldo < valor): o predicado de solvencia sera' violado.
S_A=100
S_B=50
V=150
R_A_OLD=11111
R_B_OLD=22222
R_A_NEW=33333
R_B_NEW=44444

echo "============================================================"
echo "[circuito] Tentativa de gastar SEM SALDO (a prova nem e' gerada)"
echo "[circuito]   Henrique tem $S_A e tenta enviar $V  (V > saldo)."
echo "[circuito]   O circuito impoe assert(saldo >= valor); aqui $S_A < $V."
echo "============================================================"

# ─── Compila o helper de commitment se necessario (igual ao 03) ──────────────
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

compute_commit() {
    docker run --rm \
        -v "${PROJECT_DIR}:/home/zokrates/code" \
        -w /home/zokrates/code \
        --user root \
        "${ZOKRATES_IMAGE}" \
        bash -c "
            zokrates compute-witness --json \
                -i circuits/proving_key/helper_out \
                -a $1 $2 \
                -o /tmp/helper_witness >/dev/null 2>&1
            cat /tmp/helper_witness.json | grep -oE '\"~out_0\":[[:space:]]*\"[0-9]+\"' | grep -oE '[0-9]+' | tail -n 1
        "
}

# Os commitments ANTIGOS precisam ser validos: o circuito os abre (linhas 62-63)
# ANTES de checar a solvencia (linha 78). Os NOVOS sao irrelevantes - a execucao
# para no assert(S_A >= V), bem antes de abri-los (linhas 94-95). Por isso
# passamos 0 0 como commitments novos (nunca alcancados).
echo "[circuito] Preparando commitments do estado atual (Poseidon)..."
COMMIT_A_OLD=$(compute_commit "$S_A" "$R_A_OLD")
COMMIT_B_OLD=$(compute_commit "$S_B" "$R_B_OLD")
COMMIT_A_NEW=0
COMMIT_B_NEW=0

echo "[circuito] Submetendo ao prover (zokrates compute-witness)..."
WITNESS_OK=true
docker run --rm \
    -v "${PROJECT_DIR}:/home/zokrates/code" \
    -w /home/zokrates/code \
    --user root \
    "${ZOKRATES_IMAGE}" \
    zokrates compute-witness \
        -i circuits/proving_key/out \
        -a $COMMIT_A_OLD $COMMIT_B_OLD $COMMIT_A_NEW $COMMIT_B_NEW \
           $S_A $S_B $V $R_A_OLD $R_B_OLD $R_A_NEW $R_B_NEW \
        -o /tmp/witness_insolvent >/dev/null 2>&1 || WITNESS_OK=false

echo ""
if [ "$WITNESS_OK" = false ]; then
    # Recusa do circuito = comportamento ESPERADO e correto (sucesso de seguranca).
    DVP_FROM="Henrique Lamarca" DVP_TO="Tassio Ferenzini" \
        DVP_SA="$S_A" DVP_VALUE="$V" node scripts/circuit_insolvent_card.cjs
    : > "$SENTINEL"
    exit 0
else
    echo "[circuito] ERRO GRAVE: o circuito gerou um witness para entrada insolvente!"
    echo "[circuito] Isso indicaria uma falha de seguranca no circuito de solvencia."
    exit 1
fi
