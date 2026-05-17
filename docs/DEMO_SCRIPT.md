# Roteiro de Demonstração — 5 minutos para a Banca

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira

---

## Objetivo da demo

Em 5 minutos, demonstrar que:

1. A PoC roda **integralmente** em um clone limpo (RNF04: reproducibilidade)
2. Uma transação DvP é processada com **prova ZK** verificada on-chain
3. **Nenhum saldo aparece em plaintext** em qualquer ponto do fluxo (RNF06: minimização)
4. Os **NFRs de performance** são atendidos com folga (RNF01 e RNF02)
5. A **trilha de auditoria** está disponível para o regulador (LC 105/2001)

---

## Preparação prévia (não conta no tempo de demo)

**Antes da banca chegar:**

```bash
# Limpar tudo para começar fresco
make besu:reset

# Pré-popular caches Docker (evitar download na demo)
docker pull hyperledger/besu:24.10.0
docker pull zokrates/zokrates:0.8.8

# Verificar configuração de energia (Windows: nunca suspender)
# Garantir Docker Desktop rodando

# Abrir 2 terminais lado a lado:
#   Terminal 1: para comandos (cd C:\Projetos\TCC)
#   Terminal 2: para visualizar arquivos JSON com jq

# Abrir GitHub do projeto em uma aba do navegador
# Abrir docs/figures/dvp_sequence.svg em outra aba
```

**Checklist do dia:**

- [ ] Docker Desktop rodando
- [ ] Slides preparados (opcional — pode usar README + arquivos)
- [ ] Backup: rede Besu já testada localmente nas últimas 24h

---

## Estrutura de tempo

```
0:00 ─┬─ Abertura: contexto e tese
      │
0:30 ─┼─ Setup: rede + ZKP + contratos (já preparado)
      │
1:30 ─┼─ Deploy ao vivo: scripts/04_deploy.ts
      │
2:30 ─┼─ Demo ao vivo: scripts/05_run_dvp_demo.ts
      │
3:30 ─┼─ Benchmark: validação dos NFRs
      │
4:30 ─┼─ Fechamento: convergência norma-código + perguntas
      │
5:00 ─┴─ FIM
```

---

## Script minutado

### 🎬 0:00 – 0:30 — Abertura (30s)

> "Boa tarde. Este TCC demonstra como **Zero-Knowledge Proofs e Smart Contracts** podem traduzir os princípios da **LGPD** em controles algorítmicos verificáveis no piloto do **Drex** do Banco Central."

**Mostrar na tela:** [`README.md`](../README.md) com a visão geral.

> "A tese central, ancorada na obra **Cryptolaw** da Almedina, é que a **norma jurídica e a norma algorítmica podem convergir** — cada `assert` do nosso circuito ZK materializa um princípio da LGPD."

**Apontar para:** [`docs/THEORY_CODE_IS_LAW.md`](THEORY_CODE_IS_LAW.md) e [`docs/figures/architecture.svg`](figures/architecture.svg).

---

### 🎬 0:30 – 1:30 — Setup pré-existente (60s)

> "Antes da demo, executei `make besu:up` e `make zkp:setup`. Vamos confirmar que tudo está pronto."

**Comando 1:**
```bash
docker ps | grep besu
```
> "4 validadores QBFT rodando. Esta é a mesma plataforma — Hyperledger Besu — escolhida pelo BCB para o piloto Drex."

**Comando 2:**
```bash
ls circuits/proving_key/ contracts/Verifier.sol
```
> "O setup do ZoKrates gerou a `proving.key`, `verification.key` e o `Verifier.sol` — todo o pipeline criptográfico."

> "Detalhes da escolha de Groth16 vs PLONK vs STARK estão no [ADR-0001](ADR/0001-groth16-vs-plonk-vs-stark.md), e do trusted setup local no [ADR-0003](ADR/0003-trusted-setup-handling.md)."

---

### 🎬 1:30 – 2:30 — Deploy ao vivo (60s)

**Comando 3:**
```bash
export BESU_PRIVATE_KEYS="0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63,0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3,0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f,0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"
make deploy
```

> "Em ~20 segundos, deployo os 4 contratos: `Verifier`, `PrivateToken`, `RegulatorViewer` e `DvPSettlement`. E concedo papéis de AccessControl: `MINTER_ROLE` ao admin, `SETTLEMENT_ROLE` ao DvPSettlement em ambos os contratos."

**Comando 4:**
```bash
cat deployments/besu.json | jq .
```

> "Aqui está o registro do deploy: 4 endereços, 3 papéis concedidos, bloco de inclusão. Tudo em JSON estruturado, auditável."

---

### 🎬 2:30 – 3:30 — Demo da transação DvP ao vivo (60s)

**Comando 5:**
```bash
make demo | tee /tmp/demo-output.json
```

**Pontuar enquanto roda:**

> "Estou executando o cenário T1: Alice tem saldo 100, transfere 30 para Bob, que tem saldo 50. **Mas vocês não vão ver esses números em lugar nenhum no log.**"

**Quando terminar (~10s), mostrar a saída:**

```bash
cat /tmp/demo-output.json | grep -E "100|50|30|70|80"
```

> "Vazio. Nenhum dos valores aparece. A prova foi gerada off-chain, validada on-chain pelo Verifier (custo: ~264 mil de gas), e os commitments foram atualizados atomicamente. **A privacidade é matemática, não procedural.**"

**Mostrar:** o `txHash` e o `gasUsed` na saída JSON.

---

### 🎬 3:30 – 4:30 — Validação dos NFRs (60s)

**Comando 6:**
```bash
cat benchmark/results/results.csv
```

> "Os requisitos não-funcionais foram validados:"

**Apontar para:** [`docs/figures/benchmark_proof_time.svg`](figures/benchmark_proof_time.svg) e [`docs/figures/benchmark_gas.svg`](figures/benchmark_gas.svg).

| RNF | Target | Medido | Status |
|---|---|---|---|
| RNF01 — prova off-chain | < 30s | **1.93s** | ✅ 15× melhor |
| RNF02 — verify on-chain | < 300k gas | **264k** | ✅ 12% folga |
| RNF03 — cobertura | ≥ 80% | **100% statements** | ✅ |
| RNF04 — `make all` | reproduzível | OK em < 10 min | ✅ |
| RNF06 — sem plaintext | invariante | validado programaticamente | ✅ |

> "Esses números atendem aos NFRs com folga ampla. O circuito tem apenas 1.728 constraints — pequeno o suficiente para defesa rápida e gas barato, grande o suficiente para o predicado completo de DvP."

---

### 🎬 4:30 – 5:00 — Fechamento (30s)

> "Em síntese: a PoC mostra que **cada `assert` do circuito ZoKrates é uma materialização operacional de um princípio da LGPD**. O `assert(S_A >= V)` é o princípio da necessidade do art. 6º, III. O `assert(commit(S, r) == commit_old)` é o princípio da segurança do art. 6º, VII."

**Mostrar:** [`docs/LGPD_COMPLIANCE.md`](LGPD_COMPLIANCE.md) (matriz princípio ↔ controle).

> "Toda decisão arquitetural está documentada nos 5 ADRs, todo controle técnico mapeado para o artigo LGPD correspondente, e o modelo de ameaças STRIDE cobre 18 vetores. **Convergência entre norma jurídica e norma algorítmica em escala executável.**"

> "Obrigado. Estou disponível para perguntas."

---

## Plano B — Falhas e contingências

### Se a rede Besu falhar ou estiver lenta

```bash
make demo:local        # cai para Hardhat Network in-process (instantâneo)
```

> "Estou usando o ambiente Hardhat para garantir reprodutibilidade durante a demo. Os mesmos contratos, mesmos testes — apenas o consenso é diferente. Os resultados de gas e tempo já foram validados na Besu QBFT real (mostrar CSV)."

### Se o Docker travar antes da demo

```bash
# Reiniciar Docker, depois:
make besu:reset
make besu:up
# Aguardar 30s
make zkp:setup           # reusa cache se já existe
make deploy
make demo
```

### Se a banca pedir para "ver o circuito"

```bash
cat circuits/solvency_dvp.zok
```

Apontar para os 5 `assert` numerados e suas referências LGPD em comentário.

### Se a banca pedir gas detalhado

```bash
npm run benchmark        # 30 segundos, regenera CSV
cat benchmark/results/results.csv
```

### Se faltar tempo (apenas 3 min ao invés de 5)

Cortar o segmento de **deploy ao vivo (1:30–2:30)** — falar "deploy é trivial, registrado em JSON" e pular direto para `make demo`.

### Se sobrar tempo

Mostrar:
```bash
npm test                 # 37 testes unitários + 6 integração
```
Ou abrir [`THEORY_CODE_IS_LAW.md`](THEORY_CODE_IS_LAW.md) seção 3 (análise linha-a-linha do circuito).

---

## Perguntas prováveis e respostas curtas

### "O trusted setup é seguro?"

> "Para a PoC, **não** — é local. Para produção, exigiria cerimônia MPC Powers-of-Tau com 100+ participantes, modelo Zcash. Toda a discussão e o caminho de fortalecimento estão no [ADR-0003](ADR/0003-trusted-setup-handling.md)."

### "Por que Poseidon e não Pedersen?"

> "Foi uma decisão revisada honestamente — no Passo 0 eu havia recomendado Pedersen pela homomorfia, mas ao implementar percebi que (a) a homomorfia não é necessária na nossa arquitetura porque o circuito já prova conservação internamente, e (b) Poseidon é o padrão da literatura zk moderna (Polygon zkEVM, StarkWare, e Burgos & Alchieri 2025). Documentado em [ADR-0004](ADR/0004-pedersen-vs-hash-commitment.md)."

### "Como vocês resolveriam o conflito entre imutabilidade e direito de eliminação (art. 18, VI)?"

> "Crypto-shredding como mitigação parcial — discussão completa em [ADR-0005](ADR/0005-cryptoshredding-vs-art-18-VI.md). A tese é que 'eliminação' admite interpretação como 'inacessibilidade criptográfica', alinhada com Burgos & Alchieri (2025) e o ANPD Guia de Anonimização item 4.3."

### "E ataques de timing/correlação?"

> "Risco residual documentado, referenciando Ismayilov & Özturan (2023) — categoria I2 do [THREAT_MODEL.md](THREAT_MODEL.md). Mitigação proposta: batching temporal + padding de calldata, fora do escopo desta PoC."

### "A PoC pode virar produto?"

> "Como base técnica, sim — mas três áreas exigem fortalecimento: (1) cerimônia MPC para o trusted setup, (2) auditoria de circuito por terceiro, (3) mitigações contra timing analysis. Tudo documentado nos ADRs e no THREAT_MODEL."

### "Por que não Hyperledger Fabric?"

> "Fabric não usa EVM e não tem precompileds BN128 nativos — Verifier Groth16 seria 10× mais caro. Além disso, Besu é a plataforma oficial do Drex no LIFT Lab. Justificativa completa em [ADR-0002](ADR/0002-besu-qbft-vs-fabric.md)."

---

## Materiais auxiliares (caso queiram aprofundar)

- [`docs/THEORY_CODE_IS_LAW.md`](THEORY_CODE_IS_LAW.md) — análise teórica completa
- [`docs/LGPD_COMPLIANCE.md`](LGPD_COMPLIANCE.md) — matriz princípio LGPD ↔ controle técnico
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — STRIDE com 18 ameaças
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — diagrama e descrição
- [`docs/REPRODUCIBILITY.md`](REPRODUCIBILITY.md) — guia de reprodução
- [`docs/ADR/`](ADR/) — registros de decisões arquiteturais
- [GitHub do projeto](https://github.com/HenriqueLamarca/tcc-drex-zkp-lgpd) — código fonte

---

**Boa defesa! 🎓**
