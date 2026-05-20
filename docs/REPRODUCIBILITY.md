# Guia de Reprodução — PoC DREX-ZKP-LGPD

> Reproduza a PoC inteira em **menos de 10 minutos** a partir de um clone limpo, atendendo ao RNF04 (build reprodutível).

---

## 1. Pré-requisitos

| Ferramenta | Versão | Verificar | Notas |
|---|---|---|---|
| **Docker** | ≥ 24.x | `docker --version` | Docker Desktop no Windows/macOS, Docker Engine no Linux |
| **Docker Compose** | v2.x | `docker compose version` | Já incluído no Docker Desktop |
| **Node.js** | ≥ 20 LTS | `node --version` | Validado com v20.x e v24.x |
| **npm** | ≥ 10 | `npm --version` | Acompanha o Node |
| **Git** | ≥ 2.x | `git --version` | — |
| **Git Bash** | (incluso no Git) | `& "C:\Program Files\Git\bin\bash.exe" --version` | Scripts `.sh` rodam no Git Bash |
| **GNU Make** | qualquer | `make --version` | Necessário para `make all`. Windows: `winget install ezwinports.make` (depois ver nota abaixo) |

> **Rust e ZoKrates CLI NÃO são necessários.** Toda a parte de ZoKrates roda via container Docker oficial `zokrates/zokrates:0.8.8`.

> **Windows — `make` não aparece após `winget install`:** o instalador winget pode não adicionar o binário ao PATH automaticamente. Feche e reabra o PowerShell. Se ainda assim falhar:
> ```powershell
> $makeBin = "C:\Users\$env:USERNAME\AppData\Local\Microsoft\WinGet\Packages\ezwinports.make_Microsoft.Winget.Source_8wekyb3d8bbwe\bin"
> [Environment]::SetEnvironmentVariable("Path", "$makeBin;$([Environment]::GetEnvironmentVariable('Path','User'))", "User")
> ```
> Feche e reabra o terminal após executar.

> **Windows — atenção aos scripts `.sh`:** digitar `bash <script>` no PowerShell
> pode invocar o **WSL** (que pode estar ausente ou quebrado, gerando erros
> `getpwuid(0) failed` / `Failed to translate ...`). Sempre invoque o Git Bash
> explicitamente:
> ```powershell
> & "C:\Program Files\Git\bin\bash.exe" scripts/02_test_zkp.sh
> ```
> No Linux/macOS, `bash <script>` funciona normalmente. Os targets do
> `Makefile` já chamam o Git Bash corretamente quando executados via `make`.

### Recursos mínimos da máquina

- **RAM:** 8 GB (mínimo) / 16 GB (recomendado para QBFT 4 nós)
- **Disco:** ~3 GB livres
- **CPU:** 2 cores (proof generation é single-thread)

### Máquina de referência (validada)

```
CPU:    12th Gen Intel(R) Core(TM) i5-12500H
RAM:    32 GB
OS:     Windows 11 Home
Docker: 27.3.1
Node:   v24.15.0
```

---

## 2. Reprodução completa (`make all`)

```bash
git clone https://github.com/HenriqueLamarca/tcc-drex-zkp-lgpd.git
cd tcc-drex-zkp-lgpd
npm ci
make all
```

Tempos esperados: `npm ci` ~2 min, `make all` ~5 min.

`make all` executa em sequência:

```
besu:up   →   zkp:setup   →   deploy   →   demo   →   benchmark
   ↓             ↓               ↓           ↓           ↓
 Sobe 4      Compila +      Deploya 4   Executa     Mede tempo,
 nós Besu    setup +        contratos   cenário     gas, prova
 (~30s)      Verifier.sol   na Besu     E2E         e gera CSV
             (~10s)         (~20s)      (~5s)       (~30s)
```

Saída esperada ao final: `benchmark/results/results.csv` populado.

---

## 3. Reprodução por etapas (com explicação)

Para entender o que cada passo faz e/ou debugar problemas:

### Etapa 1 — Subir a rede Besu QBFT

```bash
make besu:up
```

Sobe 4 validadores em containers Docker (`besu-network/docker-compose.yml`). A primeira execução roda o `besu-init` que:

1. Gera 4 chaves de validador via `besu operator generate-blockchain-config`
2. Cria `besu-network/networkFiles/genesis.json` com extraData QBFT
3. Calcula `bootnodes.txt` para descoberta P2P interna

Execuções subsequentes pulam a inicialização (idempotente).

**Validar** (Windows — use o Git Bash explícito; Linux/macOS — `bash` direto):

```powershell
& "C:\Program Files\Git\bin\bash.exe" besu-network/wait-for-besu.sh
```

Saída esperada: `Rede pronta — todos os 4 nos minerando`.

### Etapa 2 — Compilar circuito ZK + trusted setup

```bash
make zkp:setup
```

Roda `scripts/01_setup_zkp.sh`, que via container ZoKrates 0.8.8:

1. Compila `circuits/solvency_dvp.zok` → `circuits/proving_key/out` (1.728 constraints)
2. Executa trusted setup Groth16 → `proving.key` + `verification.key`
3. Exporta `contracts/Verifier.sol` com a verification key embutida

> **Aviso:** o trusted setup é **local** — adequado para PoC, **inseguro para produção**. Detalhes em [ADR-0003](ADR/0003-trusted-setup-handling.md).

**Smoke test do circuito (opcional):**

```bash
make zkp:test
```

Cobre 3 cenários (T1 válido, T2 saldo insuficiente, T3 `V=0`). Saída esperada: `Smoke test COMPLETO — 3/3 cenarios passaram`.

### Etapa 3 — Compilar contratos Solidity

```bash
npm run compile
```

Compila 4 contratos com `viaIR: true` (necessário pelo tamanho do `executeDvP`):
- `Verifier.sol` (gerado pelo ZoKrates)
- `PrivateToken.sol`
- `RegulatorViewer.sol`
- `DvPSettlement.sol`

### Etapa 4 — Deploy

Para a **rede Besu** (precisa estar rodando), exporte as chaves pré-financiadas e rode o deploy:

```bash
export BESU_PRIVATE_KEYS="0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63,0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3,0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f,0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"
make deploy
```

Alternativa para um **nó Hardhat local** — abra outro terminal com o nó rodando e depois execute o deploy local:

```bash
npx hardhat node
```

```bash
make deploy:local
```

Saída: `deployments/<network>.json` com endereços dos 4 contratos.

### Etapa 5 — Cenário DvP ponta-a-ponta

Contra a rede Besu:

```bash
make demo
```

Ou contra o Hardhat node:

```bash
make demo:local
```

Executa o cenário T1: Alice (S_A=100) transfere V=30 para Bob (S_B=50). Saída em JSON estruturado **sem nenhum saldo em plaintext** (validar com `jq`).

### Etapa 6 — Benchmark

```bash
npm run benchmark
```

Mede tempo de geração de prova (5 iterações, mediana), gas de verificação on-chain, gas total do `executeDvP`, e tamanho da prova. Salva em `benchmark/results/results.csv`.

**Resultados esperados** (ordem de grandeza):
- Constraints: ~1.700
- Tempo total off-chain (witness + proof): **< 5s** (RNF01: < 30s)
- Verify gas: **~260k** (RNF02: < 300k)
- Prova: 256 bytes
- executeDvP completo: ~500k gas

---

## 4. Suite de testes

### Testes unitários + cobertura

```bash
npm test
npm run coverage
```

`npm test` roda 50 testes (42 unitários + 8 de integração). `npm run coverage` exige cobertura ≥ 80% em todos.

Cobertura esperada:

```
PrivateToken.sol      100% statements / 100% branch  / 100% func / 100% lines
RegulatorViewer.sol   100% statements / 100% branch  / 100% func / 100% lines
DvPSettlement.sol     100% statements /  77.78% branch / 100% func / 100% lines
Total                 100% statements /  92% branch   / 100% func / 100% lines
```

> **Limite declarado explicitamente:** os números acima excluem `contracts/Verifier.sol` (configurado via `.solcover.js: skipFiles: ["Verifier.sol"]`). O motivo é metodológico — `Verifier.sol` é **auto-gerado pelo ZoKrates** a partir de `circuits/solvency_dvp.zok`, não é código escrito neste projeto. Sua correção depende da auditoria do próprio ZoKrates (open source, com auditorias publicadas) e dos precompileds BN128 da EVM (especificados em EIP-196/197). Em rigor: a PoC tem **100% de cobertura sobre o código que escreveu**, e zero sobre o gerador automático do verificador — sendo este último coberto indiretamente pelos testes de integração que executam o `verifyTx` real com proof válida e inválida.

### Teste de integração

```bash
npx hardhat test test/integration/dvp.spec.ts
```

Executa 8 cenários ponta-a-ponta in-process (sem Besu).

### Property-based testing do circuito

Diferente do smoke test (que valida 3 cenários fixos), este teste gera entradas pseudo-aleatórias em duas categorias — cenários válidos (esperados aceitos pelo circuito) e cenários inválidos (esperados rejeitados) — e mede a proporção de pass/fail. Reporta contra-exemplos se houver.

```bash
make zkp:property
```

Variáveis configuráveis (defaults entre parênteses): `ITER_VALID` (30), `ITER_INVALID` (30), `RNG_SEED` (1), `MAX_VALUE` (1_000_000).

Resultado da execução de referência (50 cenários, seed 1): **0 contra-exemplos**. Detalhes em `benchmark/results/property_test_report.txt`.

As 5 estratégias de geração de cenários **inválidos** cobrem:

1. `V == 0` (transferência trivial)
2. `V > S_A` (insolvência)
3. `commit_A_old` adulterado (não bate com `S_A, r_A_old`)
4. Conservação violada (Bob recebe valor extra)
5. `commit_A_new` com randomness diferente da fornecida no witness

Cobrir todos os assertions do circuito com pelo menos 5 cenários aleatórios cada eleva a defesa de "passou nos 3 testes que escrevemos" para "0 contra-exemplos em N entradas aleatórias do domínio".

---

## 5. Lint e qualidade

```bash
npm run lint
npm run typecheck
```

`npm run lint` cobre Solidity (solhint) + TypeScript (eslint). `npm run typecheck` é `tsc --noEmit`. Esperado: **zero warnings**.

---

## 6. CI (GitHub Actions)

`.github/workflows/ci.yml` executa em cada push/PR:

```
checkout  →  npm ci  →  lint  →  typecheck  →  compile  →  test  →  coverage
```

Cobertura mínima exigida: **80%** (RNF03). Falha o build se < 80%.

> **Limitação:** o CI **não** executa o setup ZoKrates (sem Docker no GitHub Actions runner padrão). O `Verifier.sol` versionado no repo é usado como artefato. Para regenerar, executar `make zkp:setup` localmente.

---

## 7. Limpeza

### Derrubar a rede Besu

`make besu:down` preserva chaves + blockchain; `make besu:reset` apaga os volumes e força re-init na próxima subida.

```bash
make besu:down
```

```bash
make besu:reset
```

### Limpar artefatos de build

Apaga o diretório `circuits/proving_key` inteiro (regerado por `make zkp:setup`).

Linux/macOS:

```bash
rm -rf node_modules cache artifacts typechain-types coverage besu-network/networkFiles circuits/proving_key
```

Windows (PowerShell):

```powershell
rm -r -fo node_modules,cache,artifacts,typechain-types,coverage,besu-network/networkFiles,circuits/proving_key
```

---

## 8. Solução de problemas

### "Docker is not running"

Inicie o Docker Desktop (Windows/macOS) ou `sudo systemctl start docker` (Linux).

### Setup ZoKrates falha com "image not found"

```bash
docker pull zokrates/zokrates:0.8.8
```

### Hardhat compile com "Stack too deep"

`viaIR: true` já está habilitado em `hardhat.config.ts`. Se você desabilitou, reabilite.

### Besu não responde após `besu:up`

Aguarde até 60s (consenso QBFT precisa estabelecer quórum). Se persistir:

```bash
make besu:reset
make besu:up
```

### Demo falha com "CommitmentMismatch"

A rede Besu tem state persistente. Se você re-roda o demo após mudanças, faça:

```bash
make besu:reset
make besu:up
make zkp:setup
make deploy
make demo
```

Se o `Verifier.sol` foi alterado (qualquer execução de `make zkp:setup` gera uma nova CRS), o redeploy é obrigatório — o passo `make deploy` acima cuida disso.

### Benchmark em Linux/macOS difere muito da máquina de referência

Esperado — performance varia com CPU. Os RNFs (< 30s, < 300k gas) têm folga ampla. Documente sua máquina de referência no cabeçalho do CSV gerado.

---

## 9. Notas importantes sobre o trusted setup

A cada execução de `make zkp:setup`, **uma nova CRS é gerada**. Isso significa:

- `Verifier.sol` muda (a verification key embutida muda)
- Provas geradas com a CRS antiga **não verificam** com o novo Verifier
- Se você commitou o `Verifier.sol` antes do setup, **redeploy é necessário** após cada `make zkp:setup`

**Recomendação:** rode `make zkp:setup` apenas quando o circuito `solvency_dvp.zok` mudar. Para uso normal, mantenha o `Verifier.sol` commitado e pule a Etapa 2.

Em produção (DREX), a CRS resultaria de uma **cerimônia MPC pública** (ADR-0003) e seria considerada um artefato imutável durante a vida útil do circuito.

---

## 10. Checklist de validação rápida

Após `make all`, verifique:

- [ ] 4 containers Besu rodando (`docker ps | grep besu`)
- [ ] `circuits/proving_key/verification.key` existe
- [ ] `contracts/Verifier.sol` existe
- [ ] `deployments/besu.json` existe e contém 4 endereços
- [ ] `benchmark/results/results.csv` existe
- [ ] CSV contém 4 linhas de operação + cabeçalho com specs
- [ ] `npm test` retorna 50 passing
- [ ] `npm run coverage` mostra ≥ 80%
- [ ] `npm run lint` sem warnings

Se todos os 9 itens estão verdes, a PoC está reproduzida com sucesso.

---

## Referências cruzadas

- [`README.md`](../README.md) — visão geral
- [`PLAN.md`](../PLAN.md) — divisão em marcos M1–M7
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — diagrama e descrição (M7)
- [`docs/THEORY_CODE_IS_LAW.md`](THEORY_CODE_IS_LAW.md) — fundamentação Cryptolaw (M7)
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — STRIDE
- [`docs/LGPD_COMPLIANCE.md`](LGPD_COMPLIANCE.md) — matriz LGPD
- [`docs/ADR/`](ADR/) — registros de decisões arquiteturais (0001–0005)
