#!/usr/bin/env bash
# =============================================================================
# run_dvp_value.sh — DvP INTERATIVO (meio-termo entre o demo valido e o de rejeicao).
#
# Saldos e partes sao FIXOS (Henrique=100, Tassio=50); o VALOR da transacao e'
# escolhido na hora, via DVP_VALUE (ou 1o argumento). Regra (a mesma do circuito):
#   - V inteiro, V > 0 e V <= saldo do pagador  -> gera a prova e EFETIVA.
#   - caso contrario -> a regra de solvencia barra: operacao NAO efetivada.
#
# Sucesso e' sinalizado pelo arquivo-sentinela .make_step.ok que o 05 escreve;
# na rejeicao por valor invalido, saimos antes (sem sentinela) -> o painel marca erro.
# =============================================================================
set -uo pipefail
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$PROJECT_DIR"

S_A=100
S_B=50
V="${DVP_VALUE:-${1:-}}"

echo "============================================================"
echo "[dvp] Liquidacao interativa (entrega contra pagamento)"
echo "[dvp]   Pagador:   Henrique Lamarca   (saldo $S_A)"
echo "[dvp]   Recebedor: Tassio Ferenzini   (saldo $S_B)"
echo "[dvp]   Valor solicitado: ${V:-<vazio>}"
echo "============================================================"

# ─── Validacao (mesma regra do circuito: inteiro, > 0, S_A >= V) ──────────────
# Em caso de recusa, emite um COMPROVANTE de operacao nao efetivada (quadro) e
# sai sem escrever o sentinela -> o painel marca como nao efetivada.
reject() {  # $1 = motivo (invalid | insufficient)
  DVP_FROM="Henrique Lamarca" DVP_TO="Tassio Ferenzini" DVP_SA="$S_A" \
    DVP_VALUE="$V" DVP_REASON="$1" node scripts/dvp_reject_card.cjs
  exit 1
}
if ! [[ "$V" =~ ^[0-9]+$ ]] || [ "$V" -le 0 ]; then
  reject "invalid"
fi
if [ "$V" -gt "$S_A" ]; then
  reject "insufficient"
fi

# ─── Valor valido: gera a prova para este V e efetiva on-chain ────────────────
echo ""
echo "[dvp] Valores validos. Gerando prova Groth16 para V=$V"
echo "[dvp]   (saldos: pagador $S_A -> $((S_A - V))   recebedor $S_B -> $((S_B + V)))..."
if ! S_A=$S_A S_B=$S_B V=$V bash scripts/03_generate_test_fixtures.sh; then
  echo "[dvp] Falha ao gerar a prova para V=$V."
  exit 1
fi

echo ""
echo "[dvp] Prova gerada. Efetivando a liquidacao on-chain..."
npm run dvp:demo
rc=$?

# ─── Restaura fixtures padrao (V=30) para manter o estado canonico do repo ────
echo ""
echo "[dvp] Restaurando fixtures padrao (V=30)..."
bash scripts/03_generate_test_fixtures.sh >/dev/null 2>&1 || true

exit "$rc"
