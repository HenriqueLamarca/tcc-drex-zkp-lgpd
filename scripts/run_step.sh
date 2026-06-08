#!/usr/bin/env bash
# =============================================================================
# run_step.sh — Executa uma etapa do Makefile (deploy/demo/benchmark) e
# considera sucesso se o script Node gravou o sentinela .make_step.ok.
#
# Motivo: no Windows, o teardown do provider Hardhat/ethers pode disparar o
# assert do libuv ("!(handle->flags & UV_HANDLE_CLOSING)") APOS a etapa ja'
# ter concluido com sucesso, corrompendo o codigo de saida. Os scripts Node
# gravam .make_step.ok antes do exit; aqui conferimos esse sentinela em vez
# do codigo de saida. Falhas reais (sem sentinela) continuam sendo detectadas.
#
# Uso: run_step.sh "<comando>"
# Ex.: run_step.sh "npm run deploy"
# =============================================================================
set +e

rm -f .make_step.ok
eval "$1"

if [ -f .make_step.ok ]; then
    rm -f .make_step.ok
    exit 0
fi

echo "[make] etapa falhou (sem sentinela de sucesso): $1" >&2
exit 1
