#!/usr/bin/env bash
# =============================================================================
# run_dvp_value.sh — DvP INTERATIVO (meio-termo entre o demo valido e o de rejeicao).
#
# Saldos e partes sao FIXOS (Henrique=100, Tassio=50 DREX); o VALOR da transacao
# e' escolhido na hora, via DVP_VALUE (ou 1o argumento). Aceita ate 2 casas
# decimais (internamente em centavos). Regra (a mesma do circuito):
#   - V > 0 e V <= saldo do pagador  -> gera a prova e EFETIVA.
#   - caso contrario -> a regra de solvencia barra: operacao NAO efetivada.
#
# Sucesso e' sinalizado pelo arquivo-sentinela .make_step.ok que o 05 escreve;
# na rejeicao por valor invalido, saimos antes (sem sentinela) -> o painel marca erro.
# =============================================================================
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

# Garante as chaves Besu (assinantes) para a etapa on-chain, caso o invocador
# nao as tenha exportado. Mesma fonte do painel/Makefile.
if [ -z "${BESU_PRIVATE_KEYS:-}" ]; then
  export BESU_PRIVATE_KEYS="$(grep -oE 'BESU_PRIVATE_KEYS[[:space:]]*:=[[:space:]]*\S+' Makefile 2>/dev/null | sed -E 's/.*:=[[:space:]]*//')"
fi

# Saldos fixos (em DREX). Internamente o circuito opera em CENTAVOS (inteiros),
# o que permite valores fracionados de ate 2 casas. A exibicao volta a DREX (05
# usa DVP_SCALE). Ex.: 100,00 DREX = 10000 centavos.
S_A_DREX="100.00"
S_B_DREX="50.00"
S_A_C=10000
S_B_C=5000
V="${DVP_VALUE:-${1:-}}"

echo "============================================================"
echo "[dvp] Liquidacao interativa (entrega contra pagamento)"
echo "[dvp]   Pagador:   Henrique Lamarca   (saldo $S_A_DREX DREX)"
echo "[dvp]   Recebedor: Tassio Ferenzini   (saldo $S_B_DREX DREX)"
echo "[dvp]   Valor solicitado: ${V:-<vazio>} DREX"
echo "============================================================"

# Converte "30.50" -> 3050 centavos sem depender de aritmetica de ponto flutuante.
to_cents() {
  local v="$1" int frac
  int="${v%%.*}"
  if [[ "$v" == *.* ]]; then frac="${v#*.}"; else frac=""; fi
  frac="${frac}00"; frac="${frac:0:2}"
  echo $(( 10#${int:-0} * 100 + 10#$frac ))
}

# ─── Validacao: numero com ate 2 casas, > 0 e <= saldo do pagador ─────────────
# Em caso de recusa, emite um COMPROVANTE de operacao nao efetivada e sai sem o
# sentinela -> o painel marca como nao efetivada.
reject() {  # $1 = motivo (invalid | insufficient)
  DVP_FROM="Henrique Lamarca" DVP_TO="Tassio Ferenzini" DVP_SA="$S_A_DREX" \
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
if [ "$V_C" -gt "$S_A_C" ]; then
  reject "insufficient"
fi

# ─── Valor valido: gera a prova (em centavos) e efetiva on-chain ──────────────
echo ""
echo "[dvp] Valor valido. Gerando prova Groth16 para V=$V DREX ($V_C centavos)..."
if ! S_A=$S_A_C S_B=$S_B_C V=$V_C bash scripts/03_generate_test_fixtures.sh; then
  echo "[dvp] Falha ao gerar a prova para V=$V."
  exit 1
fi

echo ""
echo "[dvp] Prova gerada. Efetivando a liquidacao on-chain..."
export DVP_SCALE=100   # 05 exibe os valores em DREX (centavos / 100)
npm run dvp:demo
rc=$?

# ─── Restaura fixtures padrao (cenario T1 inteiro) p/ manter o estado canonico ─
echo ""
echo "[dvp] Restaurando fixtures padrao..."
bash scripts/03_generate_test_fixtures.sh >/dev/null 2>&1 || true

exit "$rc"
