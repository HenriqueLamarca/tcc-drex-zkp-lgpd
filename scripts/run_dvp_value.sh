#!/usr/bin/env bash
# =============================================================================
# run_dvp_value.sh — DvP INTERATIVO com LIVRO-RAZAO (estado persistente).
#
# Partes FIXAS (Henrique, Tassio); o VALOR e' escolhido na hora (DVP_VALUE ou 1o
# argumento), com ate 2 casas decimais (internamente em centavos). Os SALDOS
# PERSISTEM entre transacoes on-chain (ex.: 100 -> 70 -> 50...). O estado fica em
# .dvp_state e e' zerado a cada deploy/viz:up (contratos novos = saldos iniciais).
#
# Regra (a mesma do circuito): V > 0 e V <= saldo atual do pagador -> EFETIVA;
# caso contrario -> COMPROVANTE de operacao nao efetivada (sai sem o sentinela).
# =============================================================================
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Garante as chaves Besu (assinantes) para a etapa on-chain, caso o invocador
# nao as tenha exportado. Mesma fonte do painel/Makefile.
if [ -z "${BESU_PRIVATE_KEYS:-}" ]; then
  export BESU_PRIVATE_KEYS="$(grep -oE 'BESU_PRIVATE_KEYS[[:space:]]*:=[[:space:]]*\S+' Makefile 2>/dev/null | sed -E 's/.*:=[[:space:]]*//')"
fi

STATE="$PROJECT_DIR/.dvp_state"
SENTINEL="$PROJECT_DIR/.make_step.ok"

# Restaura a fixture padrao (cenario T1) SE a fixture interativa chegou a ser
# gerada. Instalada como trap para cobrir tambem interrupcoes (ex.: aba do
# painel fechada no meio da execucao -> o servidor mata este processo); sem o
# trap, "make demo"/testes ficariam com a fixture interativa em centavos e
# exibiriam saldos crus (ex.: 6000 em vez de 100). A flag evita rodar a
# regeneracao (~30s de Docker) nos caminhos em que a fixture nao foi tocada,
# como a recusa por saldo insuficiente.
FIXTURE_DIRTY=0
restore_fixture() {
  if [ "$FIXTURE_DIRTY" = "1" ]; then
    FIXTURE_DIRTY=0
    bash scripts/03_generate_test_fixtures.sh >/dev/null 2>&1 || true
  fi
}
trap restore_fixture EXIT
trap 'restore_fixture; exit 143' TERM INT

# "30.50" -> 3050 centavos (sem ponto flutuante);  3050 -> "30.50".
to_cents() {
  local v="$1" int frac
  int="${v%%.*}"
  if [[ "$v" == *.* ]]; then frac="${v#*.}"; else frac=""; fi
  frac="${frac}00"; frac="${frac:0:2}"
  echo $(( 10#${int:-0} * 100 + 10#$frac ))
}
fmt_drex() { printf '%d.%02d' $(( $1 / 100 )) $(( $1 % 100 )); }

# ─── Le o estado atual (saldo em centavos + randomness on-chain). Inicial 100/50.
if [ -f "$STATE" ]; then
  read -r FROM_C FROM_R TO_C TO_R < "$STATE" 2>/dev/null || true
fi
: "${FROM_C:=10000}"; : "${FROM_R:=11111}"; : "${TO_C:=5000}"; : "${TO_R:=22222}"
FROM_DREX=$(fmt_drex "$FROM_C")
TO_DREX=$(fmt_drex "$TO_C")

V="${DVP_VALUE:-${1:-}}"

echo "============================================================"
echo "[dvp] Liquidacao interativa (livro-razao com estado)"
echo "[dvp]   Pagador:   Henrique Lamarca   (saldo atual $FROM_DREX DREX)"
echo "[dvp]   Recebedor: Tassio Ferenzini   (saldo atual $TO_DREX DREX)"
echo "[dvp]   Valor solicitado: ${V:-<vazio>} DREX"
echo "============================================================"

# ─── Validacao: numero com ate 2 casas, > 0 e <= saldo ATUAL do pagador ───────
# Recusa -> COMPROVANTE de operacao nao efetivada e saida sem sentinela.
reject() {  # $1 = motivo (invalid | insufficient)
  DVP_FROM="Henrique Lamarca" DVP_TO="Tassio Ferenzini" DVP_SA="$FROM_DREX" \
    DVP_VALUE="$V" DVP_REASON="$1" node scripts/dvp_reject_card.cjs
  exit 1
}
if ! [[ "$V" =~ ^[0-9]+(\.[0-9]{1,2})?$ ]]; then
  reject "invalid"
fi
V_C=$(to_cents "$V")
if [ "$V_C" -le 0 ]; then
  reject "invalid"
fi
if [ "$V_C" -gt "$FROM_C" ]; then
  reject "insufficient"
fi

# ─── Valor valido: gera a prova (centavos) p/ o estado ATUAL e efetiva ────────
NEW_FROM_C=$(( FROM_C - V_C ))
NEW_TO_C=$(( TO_C + V_C ))
R_A_NEW="$(date +%s)$RANDOM"     # randomness nova (vira a "antiga" da proxima tx)
R_B_NEW="9$(date +%s)$RANDOM"

echo ""
echo "[dvp] Valor valido. Gerando prova Groth16 (V=$V DREX)..."
echo "[dvp]   Henrique: $FROM_DREX -> $(fmt_drex "$NEW_FROM_C") DREX   |   Tassio: $TO_DREX -> $(fmt_drex "$NEW_TO_C") DREX"
FIXTURE_DIRTY=1
if ! S_A=$FROM_C S_B=$TO_C V=$V_C \
     R_A_OLD=$FROM_R R_B_OLD=$TO_R R_A_NEW=$R_A_NEW R_B_NEW=$R_B_NEW \
     bash scripts/03_generate_test_fixtures.sh; then
  echo "[dvp] Falha ao gerar a prova para V=$V."
  exit 1
fi

echo ""
echo "[dvp] Prova gerada. Efetivando a liquidacao on-chain..."
rm -f "$SENTINEL"
export DVP_SCALE=100 DVP_STATEFUL=1   # exibe em DREX e usa enderecos fixos (saldo persiste)
npm run dvp:demo
rc=$?

# ─── Atualiza o livro-razao SE a transacao efetivou (sentinela presente) ──────
if [ -f "$SENTINEL" ]; then
  echo "$NEW_FROM_C $R_A_NEW $NEW_TO_C $R_B_NEW" > "$STATE"
  echo ""
  echo "[dvp] Saldos atualizados -> Henrique $(fmt_drex "$NEW_FROM_C") DREX | Tassio $(fmt_drex "$NEW_TO_C") DREX."
fi

# ─── Restaura fixtures padrao (cenario T1 inteiro) p/ make demo / testes ──────
# (o trap de EXIT cobre tambem interrupcoes; aqui e' o caminho normal)
restore_fixture

exit "$rc"
