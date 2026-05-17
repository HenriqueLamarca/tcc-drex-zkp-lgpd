# PLAN.md — PoC Privacidade por Design no DREX

**TCC:** Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
**Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira
**Instituição:** UniAcademia | **Período:** 2026/1
**Status:** ✅ **Concluído — todos os 7 marcos entregues e validados**

---

## Ambiente fixado

| Ferramenta     | Versão          | Observação                          |
|----------------|-----------------|-------------------------------------|
| OS             | Windows 11      | ~32 GB RAM                          |
| Node.js        | v24.15.0        | Acima do v20 LTS especificado; compatível com Hardhat + ethers v6 |
| npm            | 10.9.1          |                                     |
| Docker         | 27.3.1          |                                     |
| Docker Compose | v2.29.7         |                                     |
| ZoKrates       | 0.8.8           | Via imagem Docker `zokrates/zokrates:0.8.8` — Rust não necessário no host |
| Git            | instalado       |                                     |

---

## Decisões arquiteturais fixadas

| Decisão                  | Escolha       | Justificativa                                                                 |
|--------------------------|---------------|-------------------------------------------------------------------------------|
| Rede Besu                | QBFT 4 nós    | RAM suficiente; máxima fidelidade ao DREX real                                |
| Commitment de saldo      | **Poseidon hash** (revisado em ADR-0004) | Decisão original Pedersen revisada após descoberta de imprecisão técnica; Poseidon alinhado com Burgos & Alchieri 2025 e atende RNFs com folga |
| Viewing key do regulador | R1 — ECIES off-chain | Escopo adequado para PoC; limitação documentada em LGPD_COMPLIANCE.md  |
| Esquema zk               | Groth16 sobre BN128 (ADR-0001) | Custo on-chain mínimo; alinhado com Eberhardt & Tai 2018 |
| Trusted setup            | Local na PoC; MPC obrigatório em produção (ADR-0003) | Adequado para PoC acadêmica com aviso explícito |
| Crypto-shredding         | Zerar commitment + audit trail (ADR-0005) | Mitigação parcial ao conflito imutabilidade × art. 18 VI LGPD |

---

## Resumo final dos marcos

| Marco | Conteúdo | Status |
|---|---|---|
| **M1** | Esqueleto + tooling + CI | ✅ |
| **M2** | Rede Besu QBFT (4 validadores) | ✅ |
| **M3** | Circuito ZoKrates + Verifier (1.728 constraints) | ✅ |
| **M4** | Contratos + testes unitários (100% coverage) | ✅ |
| **M5** | Integração ponta-a-ponta + testes E2E | ✅ |
| **M6** | Benchmark + STRIDE + matriz LGPD + reproducibility | ✅ |
| **M7** | Cryptolaw + ARCHITECTURE + 5 SVGs + USAGE | ✅ |

**RNFs validados:**

| RNF | Target | Medido |
|---|---|---|
| RNF01 — prova off-chain | < 30s | **1.93s** |
| RNF02 — verify on-chain | < 300k gas | **264.020** |
| RNF03 — cobertura de testes | ≥ 80% | **100% stmts/funcs/lines, 92% branch** |
| RNF04 — `make all` | reproduzível | OK em < 10 min |
| RNF06 — sem plaintext | invariante | validado programaticamente |

---

## Detalhamento dos marcos (M1 → M7)

### M1 — Esqueleto do repositório + tooling + CI mínima
**Complexidade:** Baixa | **Estimativa:** 2–3h | **Status:** ✅
**Pré-requisito:** nenhum

Entregas:
- Estrutura completa de diretórios (`circuits/`, `contracts/`, `scripts/`, `test/`, `benchmark/`, `besu-network/`, `docs/`)
- `package.json` com dependências: hardhat, ethers v6, chai, ts-node, typescript, solidity-coverage, solhint, eslint
- `hardhat.config.ts` configurado para Besu (rede local porta 8545) e Hardhat Network (fallback)
- `tsconfig.json`, `.eslintrc`, `.solhint.json`, `.gitignore` (inclui `circuits/proving_key/`, `node_modules/`, `.env`)
- `Makefile` com targets vazios documentados (`besu:up`, `zkp:setup`, `deploy`, `demo`, `test`, `benchmark`)
- `.github/workflows/ci.yml` — lint + typecheck + test (sem Besu, usa Hardhat Network)
- `README.md` esqueleto com pré-requisitos e instruções de reprodução
- Conventional Commits configurado; branch `main` com regra de proteção documentada

---

### M2 — Rede Besu local via `make besu:up`
**Complexidade:** Média | **Estimativa:** 3–5h
**Pré-requisito:** M1 concluído; Docker rodando

Entregas:
- `besu-network/genesis.json` — QBFT, chainId dedicado (ex.: 1337), período de bloco 2s, precompileds BN128 habilitados (endereços 0x06–0x08 para alt_bn128)
- `besu-network/docker-compose.yml` — 4 nós validadores Besu + bootnode, mapeamento de portas, volumes para dados persistentes
- Chaves e enodes dos 4 validadores gerados e commitados (somente para rede de teste)
- `besu-network/README.md` — instruções de start/stop/reset
- `make besu:up` sobe a rede; `make besu:down` derruba; `make besu:reset` limpa volumes
- Healthcheck: script que confirma `eth_blockNumber` incrementando nos 4 nós
- ADR-0002 redigido: justificativa QBFT vs Fabric vs Clique

---

### M3 — Circuito ZoKrates `solvency_dvp.zok` + setup + Verifier exportado
**Complexidade:** Alta | **Estimativa:** 5–8h
**Pré-requisito:** M1 concluído (M2 não bloqueante para M3)

Entregas:
- `circuits/solvency_dvp.zok` — circuito Groth16/BN128 com predicado:
  `(S_A >= V) AND (V > 0) AND (S_A_novo = S_A - V) AND (S_B_novo = S_B + V)`
  usando Poseidon hash commitments (decisão revista em ADR-0004); cada `assert` comentado com artigo LGPD correspondente
- `scripts/01_setup_zkp.sh` — wrapper Docker que executa:
  1. `zokrates compile`
  2. `zokrates setup` (Groth16, trusted setup local com aviso explícito)
  3. `zokrates export-verifier` → gera `contracts/Verifier.sol`
  4. Salva `proving_key/` e `verification.key` (gitignored)
- `contracts/Verifier.sol` gerado (não editar à mão)
- Teste de sanidade: script TypeScript gera prova válida e inválida, verifica resultado off-chain
- `make zkp:setup` executa `01_setup_zkp.sh`
- ADR-0003 redigido: trusted setup local vs MPC ceremony; limitações para produção
- ADR-0004 redigido: Pedersen vs Poseidon — decisão e trade-offs

---

### M4 — Contratos Solidity + testes unitários
**Complexidade:** Alta | **Estimativa:** 6–10h
**Pré-requisito:** M3 concluído (`Verifier.sol` disponível)

Entregas:
- `contracts/PrivateToken.sol` — contrato custom (sem IERC20; decisão de projeto):
  - Storage: `mapping(address => bytes32) public commitments` (saldo como Poseidon hash commitment)
  - Nunca armazena saldo em plaintext (LGPD art. 6º, III e XI)
  - Função `updateCommitment(address, bytes32)` — apenas DvPSettlement pode chamar
- `contracts/DvPSettlement.sol`:
  - Chama `Verifier.verifyTx(proof, publicInputs)` antes de qualquer atualização
  - Atualiza commitments de A e B atomicamente (RF03)
  - Emite evento com ciphertext ECIES (RF05) — sem dados em plaintext
  - Rate limiting básico (RNF — DoS)
  - `REGULATOR_ROLE` via AccessControl (LC 105/2001)
- `contracts/RegulatorViewer.sol`:
  - Armazena ciphertexts ECIES por transação
  - Função `getEncryptedTx(txId)` — apenas `REGULATOR_ROLE`
  - Função `cryptoShred(address)` — implementa RF06 (crypto-shredding)
- `test/unit/PrivateToken.spec.ts`
- `test/unit/DvPSettlement.spec.ts`
- `test/unit/RegulatorViewer.spec.ts`
- Cobertura ≥ 80% (`npm run coverage`)
- `solhint` sem warnings
- ADR-0001 redigido: Groth16 vs PLONK vs STARK
- ADR-0005 redigido: crypto-shredding vs art. 18, VI LGPD

---

### M5 — Integração ponta-a-ponta
**Complexidade:** Alta | **Estimativa:** 4–6h
**Pré-requisito:** M2 + M3 + M4 concluídos

Entregas:
- `scripts/04_deploy.ts` — deploya Verifier, PrivateToken, RegulatorViewer, DvPSettlement na rede Besu; salva endereços em `deployments/<network>.json`
- `scripts/05_run_dvp_demo.ts` — cenário ponta-a-ponta:
  1. Participante A: define saldo S_A via Poseidon hash commitment inicial
  2. A gera prova Groth16 off-chain (via Docker ZoKrates)
  3. A submete prova + publicInputs ao DvPSettlement
  4. Contrato verifica e atualiza commitments de A e B
  5. Regulador decripta ciphertext do evento e confirma valores
  6. Saída: JSON estruturado sem dados em plaintext
- `test/integration/dvp.spec.ts` — testa o fluxo completo contra Hardhat Network (sem Besu)
- `make deploy` e `make demo` funcionando
- `npm run dvp:demo` — saída inspecionável com `jq` sem saldos em plaintext (RNF06)

---

### M6 — Benchmark + documentação técnica + ADRs
**Complexidade:** Média | **Estimativa:** 4–6h
**Pré-requisito:** M5 concluído

Entregas:
- `benchmark/benchmark.ts` — mede e grava em CSV:
  - Tempo de geração de prova (ms)
  - Gas consumido no `verifyTx`
  - Tamanho da prova (bytes)
  - Número de constraints do circuito
  - Specs da máquina de referência declaradas no cabeçalho
- `benchmark/results/` — CSV + gráficos PNG (gerados via script)
- `npm run benchmark` executa tudo e salva resultados
- `docs/THREAT_MODEL.md` — STRIDE completo (6 categorias conforme especificação)
- `docs/LGPD_COMPLIANCE.md` — tabela com 10 princípios art. 6º + art. 5º XI + art. 18
- `docs/REPRODUCIBILITY.md` — instruções de reprodução passo-a-passo

---

### M7 — Documentação Cryptolaw + diagramas + guia de uso
**Complexidade:** Média | **Estimativa:** 4–6h
**Pré-requisito:** M6 concluído

Entregas:
- `docs/THEORY_CODE_IS_LAW.md` — conexão explícita entre Cryptolaw (Almedina), cada requisito LGPD e o circuito ZoKrates; papel do LIFT Lab / LAB / CRIA; limites do "Code is Law" per IMF Fintech Note 2024/004
- `docs/ARCHITECTURE.md` — descrição textual dos componentes
- `docs/figures/architecture.svg` — diagrama de componentes
- `docs/figures/dvp_sequence.svg` — diagrama de sequência da transação DvP
- `docs/figures/benchmark_*.svg` — gráficos do CSV
- `docs/USAGE.md` — guia prático de operação (comandos do dia a dia)
- `README.md` final — permite reprodução completa em < 10 minutos a partir de clone limpo
- `make all` executa: `besu:up` → `zkp:setup` → `deploy` → `demo` → `benchmark` (RNF04)

---

## Diagrama de dependências

```
M1 ──┬──► M2 ──────────────────────┐
     └──► M3 ──► M4 ──► M5 ◄───────┘
                          │
                          ▼
                         M6 ──► M7
```

---

## Checklist de critérios de aceite

- [ ] `npm test` — 100% dos casos verdes, cobertura ≥ 80%
- [ ] `npm run benchmark` — CSV com colunas `(operacao, tempo_ms, gas_consumido, tamanho_prova_bytes, n_constraints)`
- [ ] `npm run dvp:demo` — saída JSON sem saldos/valores em plaintext (verificar com `jq`)
- [ ] `solhint` sem warnings
- [ ] `eslint` sem warnings
- [ ] `make all` executa do zero sem intervenção manual
- [ ] `README.md` permite reprodução em < 10 minutos
- [ ] Todos os ADRs (0001–0005) redigidos
- [ ] `docs/THEORY_CODE_IS_LAW.md` com conexão linha-a-linha circuito ↔ LGPD ↔ Cryptolaw
- [ ] `docs/LGPD_COMPLIANCE.md` com todos os 10 princípios cobertos
- [ ] `docs/THREAT_MODEL.md` com 6 categorias STRIDE
- [ ] Diagramas SVG/PNG gerados

---

## Regras de engenharia (vigentes durante toda a implementação)

1. Conventional Commits em português, escopo por marco (`feat(M3): ...`, `docs(M6): ...`)
2. Citar artigo da LGPD em comentário ao implementar cada controle
3. Perguntar antes de toda decisão arquitetural não-trivial
4. Nunca inventar dados de benchmark — declarar "não medido" se necessário
5. Apontar explicitamente inconsistências com a literatura antes de implementar
6. Logs em JSON estruturado, sem expor inputs privados (RNF06)
