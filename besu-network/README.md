# Rede Hyperledger Besu QBFT (4 validadores)

Rede permissionada de teste para a PoC DREX-ZKP-LGPD. Replica o consenso
QBFT recomendado pelo BCB para o piloto do DREX, com 4 nós validadores
e tolerância bizantina de 1 nó (BFT(n) = ⌊(n-1)/3⌋).

---

## Arquitetura

```
┌──────────────────────────────────────────────────────────────────┐
│  besu-net (docker bridge network)                                │
│                                                                  │
│  ┌─────────┐  ┌─────────┐  ┌─────────┐  ┌─────────┐              │
│  │ node-1  │  │ node-2  │  │ node-3  │  │ node-4  │              │
│  │ (boot)  │  │         │  │         │  │         │              │
│  └────┬────┘  └────┬────┘  └────┬────┘  └────┬────┘              │
│       │            │            │            │                   │
└───────┼────────────┼────────────┼────────────┼───────────────────┘
        │ 8545       │ 8546       │ 8547       │ 8548
        ▼            ▼            ▼            ▼
                Hardhat / scripts / clientes RPC
```

| Nó      | Container        | RPC HTTP            | P2P    |
|---------|------------------|---------------------|--------|
| node-1  | `besu-node-1`    | `localhost:8545`    | 30303  |
| node-2  | `besu-node-2`    | `localhost:8546`    | —      |
| node-3  | `besu-node-3`    | `localhost:8547`    | —      |
| node-4  | `besu-node-4`    | `localhost:8548`    | —      |

- **chainId:** `1337`
- **Consenso:** QBFT, blocos de 2s
- **Versão Besu:** `hyperledger/besu:24.10.0`
- **Pré-compilados BN128 (alt_bn128):** habilitados via Berlin/London hardforks
- **Gas mínimo:** `0` (rede de desenvolvimento)

---

## Comandos

### Subir a rede (do diretório raiz do projeto)

```bash
make besu:up
```

Equivalente direto (Linux/macOS):

```bash
docker compose -f besu-network/docker-compose.yml up -d
bash besu-network/wait-for-besu.sh
```

> **Windows:** use o Git Bash explícito para o script `.sh` (o `bash` do
> PowerShell pode invocar o WSL):
> `& "C:\Program Files\Git\bin\bash.exe" besu-network/wait-for-besu.sh`

A primeira execução roda o service `besu-init`, que gera `networkFiles/`
(genesis, chaves dos 4 validadores, lista de bootnodes). Demora ~30–60s.
Execuções subsequentes são instantâneas.

### Derrubar a rede (preserva chaves e blockchain)

```bash
make besu:down
```

### Reset completo (apaga chaves e blockchain — força re-inicialização)

```bash
make besu:reset
```

### Logs

```bash
docker compose -f besu-network/docker-compose.yml logs -f node-1
```

### Verificar saúde

```bash
# Linux/macOS
bash besu-network/wait-for-besu.sh
# Windows (Git Bash explícito — evita o WSL)
# & "C:\Program Files\Git\bin\bash.exe" besu-network/wait-for-besu.sh
```

Saída esperada:

```
[wait] Aguardando rede Besu (timeout: 120s)...
[wait] Rede pronta — todos os 4 nos minerando.
  port 8545: bloco 5
  port 8546: bloco 5
  port 8547: bloco 5
  port 8548: bloco 5
```

---

## Contas pré-financiadas (para testes)

| Endereço                                       | Chave privada                                                       | Saldo (ETH) |
|------------------------------------------------|---------------------------------------------------------------------|-------------|
| `0xfe3b557e8fb62b89f4916b721be55ceb828dbd73`   | `0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63` | 200 |
| `0x627306090abaB3A6e1400e9345bC60c78a8BEf57`   | `0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3` | 200 |
| `0xf17f52151EbEF6C7334FAD080c5704D77216b732`   | `0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f` | 200 |

> **Aviso:** chaves apenas para rede local de desenvolvimento. **Nunca usar em mainnet.**

---

## Arquivos

| Arquivo                     | Propósito                                            |
|-----------------------------|------------------------------------------------------|
| `qbftConfigFile.json`       | Input do `besu operator generate-blockchain-config`  |
| `init.sh`                   | Script do service `besu-init` (gera chaves + genesis) |
| `start-node.sh`             | Entrypoint dos 4 validadores                         |
| `docker-compose.yml`        | Orquestração da rede                                 |
| `wait-for-besu.sh`          | Healthcheck (polla `eth_blockNumber`)                |
| `networkFiles/` (gerado)    | Genesis + chaves + bootnodes (gitignored)            |

---

## Solução de problemas

**A rede não sobe / nós não conectam:**
```bash
docker compose -f besu-network/docker-compose.yml logs besu-init
docker compose -f besu-network/docker-compose.yml logs node-1
```

**Reset total e nova tentativa:**
```bash
make besu:reset
make besu:up
```

**Verificar que blocos estão sendo minerados:**
```bash
curl -X POST -H "Content-Type: application/json" \
  --data '{"jsonrpc":"2.0","method":"eth_blockNumber","params":[],"id":1}' \
  http://localhost:8545
```
