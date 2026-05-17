# ADR-0004: Esquema de commitment — Poseidon hash vs Pedersen

- **Status:** Aceito (revisão da decisão inicial do Passo 0)
- **Data:** 2026-05-12
- **Marco:** M3 — Circuito ZoKrates + Verifier exportado
- **Decisores:** Henrique Lamarca; orientação acadêmica de Tassio Ferenzini Martins Sirqueira

---

## Contexto

Saldos de tokens privados (`PrivateToken`) são armazenados on-chain **apenas como commitments**, nunca em plaintext. Isso é fundamental para atender:

- LGPD art. 6º, III (necessidade) — dado pessoal não exposto além do necessário
- LGPD art. 5º, XI (anonimização) — saldo só recuperável por quem detém valor e randomness
- LGPD art. 6º, VII (segurança) — armazenamento criptograficamente protegido

Um commitment criptográfico tem duas propriedades essenciais:

1. **Hiding** — observador on-chain não consegue inferir o valor comprometido
2. **Binding** — o committer não consegue abrir o commitment para um valor diferente do original

Adicionalmente, o esquema escolhido precisa ser **eficiente dentro de um circuito Groth16/BN128**, pois é avaliado em cada operação ZKP.

---

## Decisão

Utilizar **Poseidon hash** como primitiva de commitment:

```
commit(value, randomness) = Poseidon([value, randomness])
```

implementado via `import "hashes/poseidon/poseidon" as poseidon` da stdlib do ZoKrates 0.8.

---

## Revisão da decisão original do Passo 0

No bootstrap inicial da PoC (Passo 0), o autor recomendou **Pedersen commitment homomórfico** afirmando que o ZoKrates teria suporte nativo via builtin. Essa afirmação foi tecnicamente imprecisa:

- O builtin `pedersen` no ZoKrates 0.8 (`hashes/pedersen/512bit.zok`) produz um **Pedersen hash**, não um **Pedersen commitment** homomórfico.
- Pedersen hash: `H(x) = x · G` — função one-way, **não-homomórfico** em valores.
- Pedersen commitment: `C(v, r) = v · G + r · H` — homomórfico em `(v, r)`, requer implementação manual sobre BabyJubJub.

A imprecisão foi reconhecida e flaggada ao usuário antes da implementação do circuito (conforme regra de engenharia do projeto: *"Se identificar inconsistência entre os requisitos e a literatura citada, aponte explicitamente antes de implementar — não corrija silenciosamente"*). A decisão foi então revisada, considerando três caminhos:

| Opção | Forma                         | Homomórfico? | Custo no circuito          | Adoção atual              |
|-------|-------------------------------|--------------|----------------------------|---------------------------|
| A     | Pedersen *commitment* manual  | **Sim**      | ~5x maior que Poseidon     | Bulletproofs, MimbleWimble |
| B     | Pedersen *hash* (stdlib)      | Não          | Médio                      | Zcash Sapling (notas)     |
| C     | **Poseidon hash (escolhido)** | Não          | Baixo                      | Polygon zkEVM, StarkWare, Burgos & Alchieri (2025) |

---

## Justificativa

### 1. A homomorfia não é necessária na arquitetura

A motivação original para Pedersen *commitment* era homomorfia: permitir que o contrato verifique conservação de valor (`C(S_A - V) + C(V) = C(S_A)`) sem revelar S_A nem V. Na nossa arquitetura, **isso já é provado dentro do circuito ZK** via assertions explícitas:

```zokrates
assert(commit(S_A_new, r_A_new) == commit_A_new);
assert(commit(S_B_new, r_B_new) == commit_B_new);
// onde S_A_new = S_A - V, S_B_new = S_B + V
```

A homomorfia traria benefício apenas em uma arquitetura onde a verificação de conservação fosse feita on-chain **sem** ZKP. Como toda a lógica é protegida pela prova Groth16, a propriedade homomórfica é redundante.

### 2. Alinhamento com a literatura de referência

**Burgos & Alchieri (2025)** — referência central do TCC para a lógica DvP — usa Poseidon como primitiva de commitment. Manter a mesma escolha facilita:

- Comparações diretas de resultados (constraints, gas, tempo de prova)
- Consistência metodológica com a literatura de referência
- Reuso futuro de fixtures e benchmarks

### 3. Custo computacional alinhado com os RNFs

Poseidon foi desenhado especificamente para circuitos ZK (Grassi et al., 2021) e é **drasticamente mais barato** que Pedersen commitment manual em constraints:

- Poseidon (t=3, 2 inputs): ~150 constraints
- Pedersen commitment via BabyJubJub: ~750+ constraints

Com 4 commitments por transação DvP (2 antes + 2 depois), a economia se acumula:

- Poseidon: ~600 constraints
- Pedersen commitment: ~3.000+ constraints

O circuito completo `solvency_dvp.zok` (M3) compila para **1.728 constraints** com Poseidon, deixando folga confortável para atender:

- **RNF01:** tempo de geração de prova < 30s (medido ~5s)
- **RNF02:** gas de verificação on-chain < 300.000 (esperado ~250k)

### 4. Padrão da indústria zk moderna

Poseidon é o hash padrão de fato em projetos ZK contemporâneos:

- **Polygon zkEVM** — Polygon Hermez utiliza Poseidon em todo o stack
- **StarkWare / StarkNet** — Poseidon é primitiva canônica do StarkNet
- **Semaphore / Polygon ID** — Identidade zero-knowledge baseada em Poseidon
- **Aztec / Noir** — Suporte nativo a Poseidon no compilador

Adotar Poseidon na PoC mantém o trabalho **alinhado ao estado-da-arte da área** e facilita extensões futuras.

---

## Consequências

### Positivas

- Circuito compacto (1.728 constraints), tempo de prova ~5s
- Verifier.sol gerado com gas estimado abaixo do limite (RNF02)
- Implementação direta via stdlib do ZoKrates — sem código manual de EC operations
- Alinhamento com Burgos & Alchieri (2025) e o estado-da-arte de zk-SNARKs

### Negativas

- **Perda do hiding por força bruta para randomness ruim:** se `r` for previsível (e.g., contador), atacante pode brute-force o valor. **Mitigação:** randomness amostrada de gerador criptográfico seguro (CSPRNG) no cliente off-chain, com pelo menos 128 bits de entropia.
- **Modelo de segurança de Poseidon é mais novo** (proposto em 2019, padronizado em 2021) que Pedersen (1991). Análise criptográfica continua ativa. **Mitigação:** uso seguindo parametrização padrão do ZoKrates 0.8 (alinhada à publicação original).

### Riscos reconhecidos

- **Risco:** descobertas futuras de criptanálise contra Poseidon.
  **Mitigação:** arquitetura modular — a função `commit` está isolada em uma função do circuito, permitindo substituição futura sem reescrever toda a lógica DvP.

- **Risco:** a mudança de decisão entre o Passo 0 e o M3 ser interpretada como inconsistência.
  **Mitigação:** este ADR documenta explicitamente a revisão e a motivação, evidenciando rigor metodológico (correção rastreável) em vez de inconsistência.

---

## Alternativas descartadas

### Opção A — Pedersen commitment manual sobre BabyJubJub

Implementação fiel ao Passo 0 original. Custo: ~5x mais constraints, prova ~25s (próximo do limite do RNF01), gas ~350k (acima do RNF02). Justificável apenas se homomorfia fosse necessária — não é o caso.

### Opção B — Pedersen hash (stdlib)

Idêntico em propriedades a Poseidon (hiding + binding, não-homomórfico) mas com custo intermediário e menor adoção na literatura zk moderna. Inferior a Poseidon em todas as dimensões avaliadas.

### Opção D (não-considerada inicialmente) — SHA-256 ou Keccak

Hashes "standard" da indústria mas extremamente caros em circuitos ZK (~50.000 constraints cada). Inviável para a PoC.

---

## Referências

- Grassi, L., Khovratovich, D., Rechberger, C., Roy, A., Schofnegger, M. (2021). *Poseidon: A New Hash Function for Zero-Knowledge Proof Systems*. USENIX Security.
- Pedersen, T. P. (1991). *Non-Interactive and Information-Theoretic Secure Verifiable Secret Sharing*. CRYPTO 1991.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
- Hopwood, D., Bowe, S., Hornby, T., Wilcox, N. (2022). *Zcash Protocol Specification* (Sapling). Uso histórico de Pedersen hash em notas.
- ZoKrates Documentation. *Standard Library — Hashes*. https://zokrates.github.io/toolbox/stdlib.html
