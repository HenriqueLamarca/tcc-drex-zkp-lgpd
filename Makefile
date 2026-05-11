.PHONY: all besu\:up besu\:down besu\:reset zkp\:setup compile deploy demo test benchmark lint help

ZOKRATES_IMAGE := zokrates/zokrates:0.8.8
BESU_COMPOSE  := besu-network/docker-compose.yml

# Executa o pipeline completo: rede → zkp → deploy → demo → benchmark
all: besu\:up zkp\:setup deploy demo benchmark

# ─── Rede Besu ────────────────────────────────────────────────────────────────

besu\:up:
	@echo "[besu] Subindo rede QBFT 4 validadores..."
	docker compose -f $(BESU_COMPOSE) up -d
	@echo "[besu] Aguardando healthcheck..."
	@bash besu-network/wait-for-besu.sh

besu\:down:
	@echo "[besu] Derrubando rede..."
	docker compose -f $(BESU_COMPOSE) down

besu\:reset:
	@echo "[besu] Resetando rede e volumes..."
	docker compose -f $(BESU_COMPOSE) down -v
	@echo "[besu] Rede resetada."

# ─── ZoKrates (via Docker) ────────────────────────────────────────────────────

zkp\:setup:
	@echo "[zkp] Executando compile + setup + export-verifier..."
	bash scripts/01_setup_zkp.sh

# ─── Contratos ────────────────────────────────────────────────────────────────

compile:
	@echo "[hardhat] Compilando contratos..."
	npm run compile

deploy:
	@echo "[hardhat] Deployando na rede Besu..."
	npm run deploy

deploy\:local:
	@echo "[hardhat] Deployando na Hardhat Network..."
	npm run deploy:local

# ─── Demo ─────────────────────────────────────────────────────────────────────

demo:
	@echo "[demo] Executando cenário DvP ponta-a-ponta..."
	npm run dvp:demo

demo\:local:
	@echo "[demo] Executando cenário DvP na Hardhat Network..."
	npm run dvp:demo:local

# ─── Testes ───────────────────────────────────────────────────────────────────

test:
	@echo "[test] Executando suite completa..."
	npm test

test\:unit:
	npm run test:unit

test\:integration:
	npm run test:integration

coverage:
	@echo "[coverage] Gerando relatório de cobertura..."
	npm run coverage

# ─── Benchmark ────────────────────────────────────────────────────────────────

benchmark:
	@echo "[benchmark] Executando benchmark e gerando CSV..."
	npm run benchmark

# ─── Qualidade de código ──────────────────────────────────────────────────────

lint:
	@echo "[lint] Verificando Solidity e TypeScript..."
	npm run lint

typecheck:
	@echo "[typecheck] Verificando tipos TypeScript..."
	npm run typecheck

# ─── Ajuda ────────────────────────────────────────────────────────────────────

help:
	@echo ""
	@echo "Targets disponíveis:"
	@echo "  make all            Pipeline completo (rede → zkp → deploy → demo → benchmark)"
	@echo "  make besu:up        Sobe rede Besu QBFT 4 nós"
	@echo "  make besu:down      Derruba rede Besu"
	@echo "  make besu:reset     Reseta rede e volumes"
	@echo "  make zkp:setup      Compila circuito + trusted setup + exporta Verifier.sol"
	@echo "  make compile        Compila contratos Solidity"
	@echo "  make deploy         Deploya contratos na rede Besu"
	@echo "  make deploy:local   Deploya contratos na Hardhat Network"
	@echo "  make demo           Executa cenário DvP ponta-a-ponta (Besu)"
	@echo "  make demo:local     Executa cenário DvP na Hardhat Network"
	@echo "  make test           Executa todos os testes"
	@echo "  make coverage       Gera relatório de cobertura"
	@echo "  make benchmark      Executa benchmark e gera CSV"
	@echo "  make lint           Lint Solidity + TypeScript"
	@echo "  make typecheck      Typecheck TypeScript"
	@echo ""
