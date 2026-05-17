# ADR-0002: Plataforma de blockchain — Hyperledger Besu (QBFT) vs Hyperledger Fabric

- **Status:** Aceito
- **Data:** 2026-05-11
- **Marco:** M2 — Rede Besu local
- **Decisores:** Henrique Lamarca; orientação acadêmica de Tassio Ferenzini Martins Sirqueira
- **Contexto regulatório:** Sistema Financeiro Nacional, DREX, LIFT Lab/BCB

---

## Contexto

A PoC precisa de uma blockchain permissionada que:

1. Sirva como ambiente de teste fiel ao DREX, projeto oficial do Banco Central do Brasil
2. Suporte execução de smart contracts compatíveis com EVM (necessário para integrar `Verifier.sol` gerado pelo ZoKrates)
3. Tenha precompileds nativos de **alt_bn128** (curva BN128) — essenciais para verificação eficiente de provas Groth16 on-chain
4. Tolere falhas bizantinas em ambiente multi-institucional (regra n ≥ 3f + 1)
5. Possa ser orquestrada localmente via Docker, sem infraestrutura externa

As candidatas analisadas foram:

| Plataforma            | Consenso          | EVM-compat | BN128 nativo | Adoção pelo BCB no DREX  |
|-----------------------|-------------------|------------|--------------|--------------------------|
| Hyperledger Besu      | QBFT, IBFT2, Clique, PoW | Sim         | Sim (precompileds 0x06–0x08)  | **Sim — plataforma oficial** |
| Hyperledger Fabric    | Raft (CFT)        | Não (chaincode em Go/Java/JS) | Não (precisa precompiled customizado) | Não |
| Polygon Edge          | IBFT, PolyBFT     | Sim         | Sim          | Não |
| Quorum (GoQuorum)     | QBFT, Raft, IBFT  | Sim         | Sim          | Descontinuado pela ConsenSys (2024) |

---

## Decisão

Adotar **Hyperledger Besu 24.10.0 com consenso QBFT em rede de 4 validadores permissionados**.

---

## Justificativa

### 1. Alinhamento direto com o DREX (peso decisivo)

O Banco Central do Brasil escolheu o Hyperledger Besu como plataforma do piloto do DREX. Documentação oficial do BCB e relatórios do **LIFT Lab** confirmam esta decisão. Para uma PoC cujo objetivo é **demonstrar conformidade LGPD em uma transação realista do DREX**, qualquer outra plataforma reduziria a validade externa do trabalho perante a comunidade técnica do SFN.

### 2. Compatibilidade EVM e suporte nativo a Groth16/BN128

O Verifier gerado pelo ZoKrates (Groth16) usa pareamentos sobre a curva alt_bn128. A EVM possui três precompileds nativos para essa curva (endereços `0x06`, `0x07`, `0x08`):

- `ECADD` — adição de pontos
- `ECMUL` — multiplicação escalar
- `ECPAIRING` — verificação de pareamento bilinear

Esses precompileds tornam a verificação de provas Groth16 economicamente viável on-chain (~250.000 gas, dentro do RNF02). O Hyperledger Fabric **não** os possui — exigiria implementação como chaincode customizado em Go, com perda significativa de desempenho e divergência da especificação EIP-196/197.

### 3. Tolerância bizantina com 4 nós

QBFT garante segurança (safety) e liveness sob `f = ⌊(n-1)/3⌋` falhas bizantinas. Com `n = 4`, tolera-se `f = 1`. Esta é a configuração mínima BFT, suficiente para uma PoC educacional que ilustra a propriedade BFT sem custo de orquestração de redes maiores.

Fabric usa Raft (Crash Fault Tolerant), que **não** tolera nós maliciosos — apenas falhas de parada. Para um sistema financeiro multi-institucional como o DREX, BFT é o requisito correto.

### 4. Reprodutibilidade local

Besu opera nativamente em containers Docker oficiais (`hyperledger/besu`). A rede pode ser orquestrada inteiramente via `docker compose up` sem dependências adicionais (nenhum CA, nenhum MSP, nenhum orderer separado como em Fabric). Atende ao RNF04 (build reprodutível com `make all`).

---

## Consequências

### Positivas

- A PoC pode ser citada como diretamente comparável ao ambiente do DREX em produção
- Provas Groth16 são verificadas em gas ~250k (vs >1M em qualquer rede sem precompileds BN128)
- Modelo de ameaças STRIDE aplicável diretamente (Besu QBFT bem documentado)
- Curva de aprendizado menor para futuros pesquisadores que estendam o trabalho

### Negativas

- Maior consumo de recursos vs single-node dev mode (~2 GB RAM com 4 validadores ativos)
- Tempo de bootstrap de ~30–60s na primeira execução (init gera chaves)
- Configuração QBFT é mais complexa que Clique/IBFT2 (mas é a recomendada pelo BCB)

### Riscos mitigados

- **Risco:** alguém tentar rodar em máquina com < 8 GB RAM.
  **Mitigação:** `README.md` declara requisito mínimo de 8 GB; abre porta para fallback dev-mode em ADR futuro se necessário.

- **Risco:** versão do Besu (24.10.0) sair de suporte ou ter breaking change.
  **Mitigação:** versão pinnada no `docker-compose.yml`; `REPRODUCIBILITY.md` documenta procedimento de upgrade controlado.

---

## Alternativas descartadas

### Hyperledger Fabric
Descartada por não usar EVM e não ter precompileds BN128 nativos. Fabric é forte em casos de uso onde múltiplas linguagens de chaincode são desejáveis e o controle de canal é central (ex.: TradeLens, Food Trust), mas não é a plataforma do DREX.

### Polygon Edge
Tecnicamente próxima ao Besu (EVM, BN128, IBFT/PolyBFT), mas sem alinhamento institucional com o BCB. Reduziria a validade externa da PoC frente ao ambiente real do DREX.

### GoQuorum / Quorum
Descontinuada oficialmente pela ConsenSys em 2024. Risco de manutenção inviabiliza adoção em trabalho acadêmico de longo prazo.

### Besu modo dev (1 nó, Clique)
Considerada como fallback caso a máquina não comporte 4 validadores. Não foi necessário ativar — máquina de referência tem 32 GB RAM. Caso seja necessário no futuro, abrir ADR-0002a documentando o downgrade.

---

## Referências

- Banco Central do Brasil. *Real Digital — DREX: Documentos técnicos*. Disponível em: https://www.bcb.gov.br/estabilidadefinanceira/drex
- Hyperledger Besu. *Documentation — QBFT Consensus*. https://besu.hyperledger.org/private-networks/how-to/configure/consensus/qbft
- EIP-196: Precompiled contracts for elliptic curve operations on alt_bn128
- EIP-197: Precompiled contract for optimal Ate pairing check on alt_bn128
- Eberhardt, J. & Tai, S. (2018). *On or Off the Blockchain? Insights on Off-Chaining Computation and Data*. ESOCC.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
