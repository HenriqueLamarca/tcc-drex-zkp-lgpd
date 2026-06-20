# Guia de Uso — PoC DREX-ZKP-LGPD

> Guia prático para operar a aplicação. Todos os comandos em PowerShell,
> a partir da pasta `C:\Projetos\TCC`.
> Referência cruzada: [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md) (reprodução
> a partir de clone limpo) e [`ARCHITECTURE.md`](ARCHITECTURE.md) (componentes
> e decisões).
>
> **IMPORTANTE — scripts `.sh`:** no Windows, digitar `bash` no PowerShell
> pode chamar o WSL (que pode estar ausente/quebrado). Use sempre o Git Bash
> explícito: `& "C:\Program Files\Git\bin\bash.exe" <script>`. Os comandos
> deste guia já usam essa forma.

---

## 0. Pré-requisitos (verificar uma vez)

```powershell
cd C:\Projetos\TCC
docker info > $null 2>&1; if ($?) { "Docker OK" } else { "ABRA O DOCKER DESKTOP" }
node --version
```

Necessário: **Docker Desktop aberto** + Node.js 20+.
Rust e ZoKrates CLI **não** são necessários — rodam via container Docker.

---

## 1. Instalação inicial (primeira vez / clone limpo)

```powershell
npm ci
```

---

## 2. Comandos do dia a dia

### Testar contratos (sem Docker, ~1 min)
```powershell
npm test
```
Esperado: `50 passing`

### Cobertura de testes
```powershell
npm run coverage
```
Esperado: 100% statements/funcs/lines nos 3 contratos

### Qualidade de código
```powershell
npm run lint
npm run typecheck
```
Esperado: sem erros

### Smoke test do circuito ZK (precisa Docker, ~1 min)
```powershell
& "C:\Program Files\Git\bin\bash.exe" scripts/02_test_zkp.sh
```
Esperado: `Smoke test COMPLETO — 3/3 cenarios passaram`
(T1 válido aceito; T2 saldo insuficiente rejeitado; T3 V=0 rejeitado)

---

## 3. Sistema completo ponta-a-ponta

### Opção A — Rede Hardhat local (rápida, para desenvolver/testar)

**Terminal 1** (deixe rodando):
```powershell
cd C:\Projetos\TCC
npx hardhat node
```

**Terminal 2**:
```powershell
cd C:\Projetos\TCC
npx hardhat run scripts/04_deploy.ts --network localhost
npx hardhat run scripts/05_run_dvp_demo.ts --network localhost        # sucesso
npx hardhat run scripts/06_run_dvp_demo_fail.ts --network localhost   # rejeicao
```

### Opção B — Rede Besu QBFT real (fiel ao DREX)

Subir a rede (4 validadores):
```powershell
docker compose -f besu-network/docker-compose.yml up -d
& "C:\Program Files\Git\bin\bash.exe" besu-network/wait-for-besu.sh
```

Definir as chaves pré-financiadas e rodar:
```powershell
$env:BESU_PRIVATE_KEYS="0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63,0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3,0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f,0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97"
npx hardhat run scripts/04_deploy.ts --network besu
npx hardhat run scripts/05_run_dvp_demo.ts --network besu        # sucesso
npx hardhat run scripts/06_run_dvp_demo_fail.ts --network besu   # rejeicao
```

> Os mesmos cenários têm atalhos via Make: `make demo` (sucesso), `make demo:fail`
> (rejeição) e `make demo:both` (os dois em sequência). As demos são re-executáveis
> quantas vezes quiser, sem precisar resetar a rede.

Desligar a rede ao terminar:
```powershell
docker compose -f besu-network/docker-compose.yml down
```

---

## 4. Benchmark (tempo de prova + gas on-chain)

```powershell
npm run benchmark
Get-Content benchmark/results/results.csv
```
Esperado (máquina de referência): verify gas ~264.020, prova off-chain ~1.9s.

---

## 5. Validar privacidade (RNF06)

```powershell
npx hardhat run scripts/05_run_dvp_demo.ts --network localhost | Select-String '"100"','"50"','"30"'
```
**Resultado vazio = privacidade comprovada** — nenhum saldo (100, 50) nem
valor transferido (30) aparece em plaintext nos logs.

---

## 6. Pipeline completo automático

```powershell
make all
```
Executa em sequência: `besu:up` → `zkp:setup` → `deploy` → `demo` → `demo:fail` → `benchmark`.
Requer `make` instalado; sem ele, executar as seções 3B + 4 manualmente.

---

## 7. Painel visual (recomendado para apresentação)

Um único comando sobe a rede Besu, prepara o circuito e abre um painel no navegador,
onde os cenários são executados por botões (cada botão roda o script real do projeto):

```powershell
make viz:up
```

Abre `http://localhost:4173`. Na inicialização, o terminal mostra `Chaves Besu
carregadas: 4` — se aparecer, está tudo certo. No navegador, use os botões na ordem:
**Deploy → Liquidação válida → Liquidação inválida → Benchmark**. A liquidação
inválida resulta em um badge vermelho de rejeição (comportamento esperado de segurança).

Se a rede já estiver no ar, `make viz` abre só o painel. Caso a porta 4173 esteja
ocupada por um painel anterior, encerre-o (`Ctrl + C`) antes de abrir outro.

Ao encerrar o `make viz:up` com **`Ctrl + C`**, a rede Besu é **derrubada automaticamente**
(o `make viz` avulso encerra só o painel e deixa a rede no ar).

> **Liquidação interativa (você escolhe o valor).** No painel há o bloco *"★ Liquidação
> interativa"*: saldos e partes são fixos (Henrique 100 → Tassio 50) e você digita o
> **valor da transação**. Ao clicar em *Liquidar este valor*, a prova é **gerada na hora**
> para aquele valor: se for válido (`0 < valor ≤ 100`) a liquidação **efetiva**; acima de
> 100 (sem saldo) é **rejeitada** pela regra de solvência — sem nem gerar a prova.
> No terminal: `make dvp:value V=120`.

> **Capturas para o artigo (modo compacto).** No painel, a *Liquidação válida* e a
> *Liquidação inválida* já rodam em **modo compacto**: cada resultado sai como um
> quadro auto-contido — **Comprovante de liquidação**, **Trilha de auditoria** e
> **Rejeição** — que cabe em uma única captura de tela (ideal para as figuras).
> Para obter os mesmos quadros no terminal, ative o modo antes de rodar a demo:
> ```powershell
> $env:DEMO_COMPACT="1"; make demo        # comprovante + trilha de auditoria
> $env:DEMO_COMPACT="1"; make demo:fail   # rejeição
> $env:DEMO_COMPACT=$null                  # volta ao modo detalhado
> ```

---

## Tabela de cenários

| Quero... | Comando |
|---|---|
| Testar contratos | `npm test` |
| Ver cobertura | `npm run coverage` |
| Testar o circuito ZK | `& "C:\Program Files\Git\bin\bash.exe" scripts/02_test_zkp.sh` |
| Rede local rápida | Seção 3, Opção A |
| Rede Besu QBFT | Seção 3, Opção B |
| Demonstrar liquidação aceita | `make demo` |
| Demonstrar liquidação rejeitada | `make demo:fail` |
| Medir performance | `npm run benchmark` |
| Validar privacidade | Seção 5 |
| Apresentar com painel visual | `make viz:up` (Seção 7) |
| Tudo de uma vez | `make all` |

---

## Solução de problemas

| Sintoma | Solução |
|---|---|
| `WSL ... ERROR ... getpwuid(0) failed` ao rodar `.sh` | O `bash` chamou o WSL. Use `& "C:\Program Files\Git\bin\bash.exe" <script>` |
| "Docker is not running" | Abrir Docker Desktop, aguardar "running" |
| Besu não responde | `docker compose -f besu-network/docker-compose.yml down -v` e subir de novo |
| Demo "CommitmentMismatch" na Besu | Estado antigo: `down -v` + repetir Seção 3B |
| `npx hardhat node` "porta em uso" | Fechar outros nós ou reiniciar o terminal |
| Setup ZoKrates "image not found" | `docker pull zokrates/zokrates:0.8.8` |

---

> Detalhes completos de reprodução em [`REPRODUCIBILITY.md`](REPRODUCIBILITY.md).
> Arquitetura e decisões em [`ARCHITECTURE.md`](ARCHITECTURE.md) e [`ADR/`](ADR/).
