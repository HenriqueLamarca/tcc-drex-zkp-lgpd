# PoC: Privacidade por Design no DREX
### ZKP + Smart Contracts para Conformidade com a LGPD

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Instituição:** UniAcademia | **Período:** 2026/1
> **Orientador:** Tassio Ferenzini Martins Sirqueira

---

## Visão geral

Esta Prova de Conceito demonstra uma transação **DvP (Delivery vs Payment)** entre dois participantes em rede **Hyperledger Besu permissionada (QBFT)**, onde o pagador prova criptograficamente que possui saldo suficiente para a transferência **sem revelar o saldo nem o valor** ao restante da rede.

A abordagem implementa o paradigma off-chain/on-chain de Eberhardt & Tai (2018), estendido com a lógica DvP de Burgos & Alchieri (2025), usando **ZoKrates 0.8.8 + Groth16 (BN128)** e **Pedersen commitments**.

**Princípios LGPD atendidos:** minimização (art. 6º, III), necessidade (art. 6º, III), anonimização (art. 5º, XI) e segurança (art. 6º, VII).

---

## Pré-requisitos

| Ferramenta | Versão mínima | Verificar |
|---|---|---|
| Docker | 24.x | `docker --version` |
| Docker Compose | v2.x | `docker compose version` |
| Node.js | 20 LTS | `node --version` |
| npm | 10.x | `npm --version` |
| Git | 2.x | `git --version` |

> ZoKrates roda via Docker (`zokrates/zokrates:0.8.8`) — não é necessário instalar Rust no host.

---

## Reprodução completa (< 10 minutos)

```bash
# 1. Clonar o repositório
git clone <url-do-repo>
cd drex-zkp-lgpd-poc

# 2. Instalar dependências Node.js
npm ci

# 3. Pipeline completo: rede → zkp → deploy → demo → benchmark
make all
```

### Passos individuais

```bash
# Subir rede Besu QBFT 4 nós
make besu:up

# Compilar circuito ZoKrates + trusted setup + exportar Verifier.sol
make zkp:setup

# Compilar e deployar contratos
make deploy

# Executar cenário DvP ponta-a-ponta
make demo

# Executar benchmark (gera CSV em benchmark/results/)
make benchmark
```

---

## Testes

```bash
# Suite completa (Hardhat Network — sem Besu necessário)
npm test

# Apenas testes unitários
npm run test:unit

# Apenas testes de integração
npm run test:integration

# Relatório de cobertura (mínimo: 80%)
npm run coverage
```

---

## Lint e qualidade

```bash
# Solidity + TypeScript
npm run lint

# Apenas Solidity
npm run lint:sol

# Apenas TypeScript
npm run lint:ts

# Typecheck
npm run typecheck
```

---

## Estrutura do projeto

```
circuits/           Circuito ZoKrates (solvency_dvp.zok)
contracts/          Contratos Solidity (PrivateToken, DvPSettlement, RegulatorViewer, Verifier)
scripts/            Deploy e demo ponta-a-ponta
test/               Testes unitários e de integração
benchmark/          Medições de performance (tempo de prova, gas, tamanho)
besu-network/       Configuração da rede Hyperledger Besu (QBFT 4 nós)
docs/               Documentação técnica, ADRs, matriz LGPD, modelo de ameaças
```

---

## Documentação

| Documento | Descrição |
|---|---|
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | Diagrama e descrição dos componentes |
| [THEORY_CODE_IS_LAW.md](docs/THEORY_CODE_IS_LAW.md) | Conexão Cryptolaw ↔ LGPD ↔ circuito ZoKrates |
| [LGPD_COMPLIANCE.md](docs/LGPD_COMPLIANCE.md) | Matriz princípio LGPD → controle técnico |
| [THREAT_MODEL.md](docs/THREAT_MODEL.md) | Modelo de ameaças STRIDE |
| [REPRODUCIBILITY.md](docs/REPRODUCIBILITY.md) | Guia detalhado de reprodução |
| [DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md) | Roteiro de demonstração (5 min) para a banca |
| [ADR/](docs/ADR/) | Registros de decisões arquiteturais (0001–0005) |

---

## Referências principais

- Eberhardt, J. & Tai, S. (2018). *On or Off the Blockchain? Insights on Off-Chaining Computation and Data*
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391
- Ismayilov, A. & Özturan, C. (2023). *Privacy Attacks on ZKP-Based Protocols*
- Lopes, F. et al. *Cryptolaw: Inovação, Direito e Desenvolvimento*. Almedina
- IMF Fintech Note 2024/004. *Privacy in CBDC Systems*

---

## Licença

Uso acadêmico — TCC UniAcademia 2026/1.
