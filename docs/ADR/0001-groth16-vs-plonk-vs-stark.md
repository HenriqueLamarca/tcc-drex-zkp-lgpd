# ADR-0001: Esquema de prova zk — Groth16 vs PLONK vs STARK

- **Status:** Aceito
- **Data:** 2026-05-12
- **Marco:** M4 — Contratos Solidity + testes unitários (consolidação retroativa)
- **Decisores:** Henrique Lamarca; orientação acadêmica de Tassio Ferenzini Martins Sirqueira

---

## Contexto

A escolha do esquema de prova é a decisão mais impactante na arquitetura de uma PoC ZKP. Ela define:

- O custo de **gas** da verificação on-chain (impacta RNF02: < 300.000 gas)
- O **tempo de geração** de prova off-chain (impacta RNF01: < 30s)
- A necessidade ou não de **trusted setup** (e qual modelo)
- A **maturidade** da implementação (auditorias, ataques conhecidos, suporte)
- A **compatibilidade** com a EVM (precompileds disponíveis)

O DREX exige verificação on-chain barata (operações em larga escala, todas elas pagam gas) e curva compatível com os precompileds do BCB-Besu — ou seja, BN128 (alt_bn128) prioritário.

Foram analisados três esquemas, todos suportados como backend pelo ZoKrates 0.8:

---

## Decisão

Adotar **Groth16** (Jens Groth, 2016) como esquema de prova zk-SNARK, sobre a curva **BN128** (alt_bn128), com setup gerado por `scripts/01_setup_zkp.sh` e Verifier exportado pelo ZoKrates.

---

## Comparativo técnico

| Eixo                              | Groth16                | PLONK                   | STARK                   |
|-----------------------------------|------------------------|-------------------------|-------------------------|
| **Tipo**                          | zk-SNARK               | zk-SNARK universal      | zk-STARK                |
| **Tamanho da prova**              | ~256 bytes (3 G1+G2)   | ~480 bytes              | ~50–200 KB              |
| **Tempo de verificação on-chain** | O(1) — pareamento      | O(log n)                | O(log² n)               |
| **Gas de verificação (BN128)**    | ~250.000               | ~400.000–600.000        | > 5.000.000 ou inviável |
| **Trusted setup**                 | Per-circuit (cerimônia)| Universal + atualizável | **Não tem**             |
| **Curva**                         | BN128 / BLS12-381      | BN128 / BLS12-381       | Field STARK (não EVM)   |
| **Tempo de prova (1.728 constraints)** | ~5s              | ~12s                    | ~30s+                   |
| **Suporte ZoKrates 0.8**          | Padrão (`-s g16`)      | `-s plonk` (experimental)| Não suportado          |
| **Maturidade na EVM**             | Mais alta (Tornado Cash, Zcash, Semaphore) | Crescente (Polygon zkEVM) | Polygon Miden, mas não nativo EVM |
| **Resistência pós-quântica**      | Não (depende de DLP)   | Não                     | **Sim** (hash-based)    |

---

## Justificativa para Groth16

### 1. Custo on-chain mínimo (RNF02 atendido com folga)

A verificação Groth16 reduz-se a **uma única operação de pareamento bilinear** sobre alt_bn128 (precompiled `0x08` na EVM). Mais as operações `0x06` (ECADD) e `0x07` (ECMUL). Custo total medido: **~250.000 gas**, que está abaixo do limite RNF02 (< 300.000) com 17% de margem.

PLONK, embora mais flexível, exige verificação O(log n) e tipicamente consome 400k–600k gas — fora do limite.

STARK, em sua forma pura, não tem precompileds compatíveis na EVM. Verificação seria > 5M gas ou inviável.

### 2. Tempo de prova compatível com UX da PoC (RNF01 atendido)

Geração de prova Groth16 sobre o circuito `solvency_dvp.zok` (1.728 constraints) leva ~5s na máquina de referência. PLONK levaria ~12s (ainda OK). STARK levaria 30s+ (no limite do RNF01).

Para a defesa do TCC (demo ao vivo), 5s é confortável. 30s seria desconfortável.

### 3. Prova compacta (256 bytes)

A prova Groth16 cabe em ~256 bytes — calldata mínima, custo de inclusão em bloco mínimo. Importante em rede permissionada onde múltiplas DvPs por bloco são esperadas.

STARK gera provas de 50KB+ — proibitivo em calldata Ethereum.

### 4. Maturidade e ferramental

Groth16 é o backend padrão do ZoKrates 0.8 e tem implementações auditadas em produção desde 2018:
- Zcash Sapling/Sprout (~2017)
- Tornado Cash (2019, antes do banimento)
- Semaphore / Polygon ID (em produção)
- Loopring / zkSync 1.0

PLONK é mais novo (2019), com implementações em rápido crescimento mas menos batalhadas em produção.

STARK é maduro em ecossistemas próprios (StarkWare/StarkNet) mas **não na EVM nativa**.

### 5. Alinhamento com a literatura de referência

- **Eberhardt & Tai (2018)** — paradigma off/on-chain — usa Groth16
- **Burgos & Alchieri (2025)** — referência DvP do TCC — usa Groth16
- **Almeida et al. (2024)** — análise de ZKPs no DREX — recomenda Groth16 para o piloto

Adotar o mesmo esquema permite comparar resultados (constraints, gas, tempo) com a literatura sem ajustes não-triviais.

---

## Consequências

### Positivas

- Verificação on-chain mais barata da indústria (~250k gas)
- Tempo de prova adequado para demo ao vivo
- Prova compacta facilita armazenamento e auditoria
- Ferramenta madura, com auditorias publicadas
- Compatibilidade direta com precompileds Besu/BN128

### Negativas

- **Trusted setup per-circuit:** qualquer mudança em `solvency_dvp.zok` invalida a CRS e exige nova cerimônia. Mitigação documentada em **ADR-0003**.
- **Não pós-quântico:** segurança depende de DLP em curvas elípticas. Para um horizonte de 10–15 anos no DREX, isso pode se tornar relevante. Mitigação: arquitetura modular permite substituir o esquema sem reescrever circuito ou contratos (somente Verifier muda).
- **Universalidade ausente:** se o DREX adicionar novos predicados (ex.: prova de não-blacklist, prova de origem), cada um exige sua própria cerimônia. PLONK seria mais conveniente nesse cenário — reaberto em ADR futuro se demanda surgir.

### Riscos reconhecidos

- **Risco:** comprometimento da CRS (toxic waste retido) → falsificação de provas.
  **Mitigação:** discutida em ADR-0003 (cerimônia MPC para produção).

- **Risco:** futuro algoritmo quântico (Shor) quebrar BN128.
  **Mitigação:** modularidade do Verifier permite migração para STARK ou esquema híbrido com replanejamento limitado a M3 e parte do M4.

---

## Alternativas descartadas

### PLONK (Plonky2, Halo2, etc.)

Trade-off favorável em flexibilidade (setup universal e atualizável) mas pior em gas de verificação (~2x). Para uma PoC com circuito único, a vantagem de universalidade não compensa. Recomendado **reabrir** se o DREX expandir o conjunto de predicados privados.

### zk-STARK (Cairo, Noir-STARK)

Não-EVM-nativo (sem precompileds), prova grande (50KB+), gas inviável. Excelente em ambientes próprios (StarkNet) mas inadequado para DREX/Besu. Resistência pós-quântica é o único ponto onde STARK ganha — pode ser revisitado em horizonte de 10+ anos.

### zk-SNARK Sonic / Marlin

Esquemas universais alternativos. Sonic tem custo de prova proibitivo. Marlin é uma melhoria mas ainda mais caro on-chain que Groth16. ZoKrates 0.8 lista `marlin` como opção mas com performance inferior a Groth16 e PLONK.

---

## Referências

- Groth, J. (2016). *On the Size of Pairing-Based Non-interactive Arguments*. EUROCRYPT 2016.
- Gabizon, A., Williamson, Z. J., Ciobotaru, O. (2019). *PLONK: Permutations over Lagrange-bases for Oecumenical Noninteractive arguments of Knowledge*. IACR ePrint 2019/953.
- Ben-Sasson, E., Bentov, I., Horesh, Y., Riabzev, M. (2018). *Scalable, transparent, and post-quantum secure computational integrity*. IACR ePrint 2018/046.
- EIP-196: Precompiled contracts for elliptic curve operations on alt_bn128.
- EIP-197: Precompiled contract for optimal Ate pairing check on alt_bn128.
- Eberhardt, J. & Tai, S. (2018). *On or Off the Blockchain? Insights on Off-Chaining Computation and Data*.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
- ZoKrates Documentation. *Backends and proving schemes*. https://zokrates.github.io/toolbox/proving_schemes.html
