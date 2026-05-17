# PoC: Privacidade por Design no DREX
### Zero-Knowledge Proofs + Smart Contracts para Conformidade com a LGPD

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Instituição:** UniAcademia | **Período:** 2026/1
> **Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira
> **Status:** ✅ PoC concluída — todos os 7 marcos entregues

---

## Visão geral

Esta Prova de Conceito demonstra uma transação **DvP (Delivery vs Payment)** entre dois participantes em rede **Hyperledger Besu QBFT permissionada** (4 validadores), onde o pagador prova criptograficamente que possui saldo suficiente para a transferência **sem revelar o saldo nem o valor**.

A abordagem replica o paradigma off-chain/on-chain de **Eberhardt & Tai (2018)**, estende com a lógica DvP de **Burgos & Alchieri (2025)** e ancora-se teoricamente na obra **Cryptolaw: Inovação, Direito e Desenvolvimento** (Almedina) — cada `assert` do circuito ZoKrates é uma materialização operacional de um princípio da LGPD.

**Stack:** ZoKrates 0.8.8 + Groth16 (BN128) · Solidity 0.8.20 + Hardhat · Hyperledger Besu 24.10.0 (QBFT 4 nós) · TypeScript + ethers v6.

---

## Resultados consolidados

Todos os requisitos não-funcionais foram **validados com folga**:

| Requisito | Target | Medido | Status |
|---|---|---|---|
| **RNF01** Geração de prova off-chain | < 30s | **1.93s** | ✅ 15× melhor |
| **RNF02** Gas de verificação on-chain | < 300.000 | **264.020** | ✅ 12% folga |
| **RNF03** Cobertura de testes | ≥ 80% | **100% statements** | ✅ |
| **RNF04** Build reprodutível (`make all`) | < 10 min | OK | ✅ |
| **RNF05** Determinismo do trusted setup | documentado | ADR-0003 | ✅ |
| **RNF06** Logs sem dados em plaintext | invariante | validado programaticamente | ✅ |

**Estatísticas do circuito:** 1.728 constraints, 256 bytes de prova, 4 public inputs.

**Estatísticas dos contratos:** 4 contratos, 50 testes (42 unitários + 8 de integração) — todos passando — cobertura 100% statements/functions/lines, 92% branches.

---

## Pré-requisitos

| Ferramenta | Versão | Notas |
|---|---|---|
| **Docker** | ≥ 24.x | Docker Desktop no Windows/macOS |
| **Docker Compose** | v2.x | Já incluído no Docker Desktop |
| **Node.js** | ≥ 20 LTS | Validado com v20 e v24 |
| **npm** | ≥ 10 | — |
| **Git** | ≥ 2.x | Bash incluído via Git for Windows |

> **Rust e ZoKrates CLI NÃO são necessários** — toda a parte ZK roda via container `zokrates/zokrates:0.8.8`.

**Recursos mínimos:** 8 GB RAM (16 GB recomendado para QBFT 4 nós).

---

## Reprodução completa em < 10 minutos

```bash
git clone https://github.com/HenriqueLamarca/tcc-drex-zkp-lgpd.git
cd tcc-drex-zkp-lgpd
npm ci                # ~2 min
make all              # ~5 min: rede + setup + deploy + demo + benchmark
```

Detalhes em [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md) (10 seções, com troubleshooting).

---

## Comandos principais

| Comando | Descrição |
|---|---|
| `make besu:up` | Sobe rede Besu QBFT (4 validadores) |
| `make besu:down` | Derruba a rede |
| `make besu:reset` | Reset completo (apaga volumes) |
| `make zkp:setup` | Compila circuito + trusted setup + gera Verifier.sol |
| `make zkp:test` | Smoke test off-chain do circuito (3 cenários) |
| `npm run compile` | Compila contratos Solidity |
| `npm test` | 50 testes (42 unitários + 8 de integração) |
| `npm run coverage` | Cobertura (mínimo 80%) |
| `npm run lint` | Solidity (solhint) + TypeScript (eslint) |
| `make deploy` | Deploy na rede Besu (precisa estar rodando) |
| `make deploy:local` | Deploy na Hardhat Network |
| `make demo` | Cenário DvP ponta-a-ponta na Besu |
| `make demo:local` | Demo na Hardhat Network |
| `npm run benchmark` | Mede tempo, gas, tamanho — gera CSV |

---

## Documentação

### Núcleo teórico
| Documento | Descrição |
|---|---|
| [`docs/THEORY_CODE_IS_LAW.md`](docs/THEORY_CODE_IS_LAW.md) | Convergência norma jurídica × norma algorítmica (âncora Cryptolaw); análise linha-a-linha do circuito |
| [`docs/LGPD_COMPLIANCE.md`](docs/LGPD_COMPLIANCE.md) | Matriz com 10 princípios do art. 6º + art. 5º XI + art. 18 + art. 46 |

### Arquitetura e operação
| Documento | Descrição |
|---|---|
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Diagrama de componentes, fluxo de dados, modelo de papéis |
| [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) | STRIDE com 18 ameaças (16 mitigadas) |
| [`docs/REPRODUCIBILITY.md`](docs/REPRODUCIBILITY.md) | Guia de reprodução em < 10 min |
| [`docs/USAGE.md`](docs/USAGE.md) | Guia prático de operação (comandos do dia a dia) |

### Decisões arquiteturais (ADRs)
| ADR | Decisão |
|---|---|
| [0001](docs/ADR/0001-groth16-vs-plonk-vs-stark.md) | Groth16 vs PLONK vs STARK — escolhemos Groth16 sobre BN128 |
| [0002](docs/ADR/0002-besu-qbft-vs-fabric.md) | Besu QBFT vs Fabric — escolhemos Besu (alinhamento com DREX/BCB) |
| [0003](docs/ADR/0003-trusted-setup-handling.md) | Trusted setup local na PoC; MPC obrigatório em produção |
| [0004](docs/ADR/0004-pedersen-vs-hash-commitment.md) | Poseidon hash em vez de Pedersen (revisão honesta da decisão original) |
| [0005](docs/ADR/0005-cryptoshredding-vs-art-18-VI.md) | Crypto-shredding como mitigação ao conflito imutabilidade × art. 18 VI |

### Diagramas (em `docs/figures/`)
- `architecture.svg` — componentes da arquitetura
- `dvp_sequence.svg` — sequência da transação DvP ponta-a-ponta
- `benchmark_proof_time.svg` — tempo de prova vs RNF01
- `benchmark_gas.svg` — gas on-chain vs RNF02
- `benchmark_constraints.svg` — características do circuito

Regenerar: `npx ts-node docs/figures/generate_svgs.ts`

---

## Estrutura do projeto

```
.
├── circuits/                  Circuito ZoKrates + setup (proving_key/ gitignored)
├── contracts/                 PrivateToken, DvPSettlement, RegulatorViewer, Verifier
├── scripts/                   01_setup_zkp, 02_test_zkp, 03_fixtures, 04_deploy, 05_demo
├── test/
│   ├── unit/                  42 testes unitários
│   ├── integration/           8 testes E2E in-process
│   └── fixtures/              Helpers + proof fixtures
├── benchmark/                 Script + results.csv
├── besu-network/              Hyperledger Besu QBFT (4 nós) via docker-compose
├── docs/
│   ├── ARCHITECTURE.md, THEORY_CODE_IS_LAW.md, LGPD_COMPLIANCE.md
│   ├── THREAT_MODEL.md, REPRODUCIBILITY.md, USAGE.md
│   ├── ADR/                   5 registros de decisão arquitetural
│   └── figures/               Diagramas SVG + script gerador
├── deployments/               Endereços dos contratos por rede (gitignored)
├── .github/workflows/ci.yml   Pipeline de CI (lint + typecheck + test + coverage)
├── hardhat.config.ts, Makefile, package.json, README.md, PLAN.md
```

---

## Marcos do projeto

| Marco | Conteúdo | Status |
|---|---|---|
| **M1** | Esqueleto + tooling + CI mínima | ✅ |
| **M2** | Rede Hyperledger Besu QBFT (4 nós) | ✅ |
| **M3** | Circuito ZoKrates + Verifier exportado | ✅ |
| **M4** | Contratos Solidity + testes unitários (100% coverage) | ✅ |
| **M5** | Integração ponta-a-ponta (deploy + demo + integração) | ✅ |
| **M6** | Benchmark + threat model + matriz LGPD + reproducibility | ✅ |
| **M7** | Cryptolaw + ARCHITECTURE + diagramas SVG + guia de uso | ✅ |

Detalhes da divisão e estimativas em [`PLAN.md`](PLAN.md).

---

## Referências principais

### Doutrina jurídica
- **Lei 13.709/2018** — LGPD
- **LC 105/2001** — Sigilo bancário
- **ANPD (2024)** — Guia de Anonimização
- **Lopes, F. et al.** — *Cryptolaw: Inovação, Direito e Desenvolvimento* (Almedina) — **âncora teórica**
- **Doneda, D. (2019); Pinheiro, P. P. (2020)** — comentários à LGPD

### Teoria do "Code is Law"
- **Lessig, L. (1999, 2006)** — *Code and Other Laws of Cyberspace*
- **De Filippi & Wright (2018)** — *Blockchain and the Law*

### Documentos institucionais
- **BCB / LIFT Lab** — Documentos do piloto DREX
- **CVM / CRIA** — Sandbox regulatório
- **IMF Fintech Note 2024/004** — *Privacy in CBDC Systems*

### Literatura técnica
- **Eberhardt & Tai (2018)** — *On or Off the Blockchain?*
- **Burgos & Alchieri (2025)** — *Privacy-Preserving DvP* (arXiv:2501.03391)
- **Ismayilov & Özturan (2023)** — *Privacy Attacks on ZKP-Based Protocols*
- **Groth (2016)** — *Pairing-Based Non-interactive Arguments*
- **Grassi et al. (2021)** — *Poseidon: A New Hash Function for ZK*

---

## Licença

Uso acadêmico — TCC UniAcademia 2026/1.
