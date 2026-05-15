# Matriz de Conformidade LGPD — PoC DREX-ZKP-LGPD

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira | **Período:** 2026/1

---

## Como ler esta matriz

Para cada princípio/direito da LGPD relevante à PoC, indicamos:

- **Princípio LGPD (artigo)**: dispositivo legal exato (Lei 13.709/2018)
- **Como a PoC atende**: descrição operacional
- **Controle técnico (arquivo:linha)**: implementação específica e rastreável no repositório
- **Tradução em norma algorítmica**: a "norma algorítmica" (Lopes et al., *Cryptolaw*) — como o conceito jurídico aparece como restrição computacional
- **Limitação reconhecida**: o que a PoC **não** atende plenamente, declarado honestamente

A âncora teórica desta matriz é a obra **Cryptolaw: Inovação, Direito e Desenvolvimento** (Almedina) e a discussão de "convergência entre norma jurídica e norma algorítmica". Cada linha desta tabela é uma **instância concreta** dessa convergência aplicada ao SFN/DREX.

---

## Tabela Principal — Art. 6º (Princípios)

| # | Princípio LGPD (art. 6º) | Como a PoC atende | Controle técnico (arquivo:linha) | Tradução em norma algorítmica | Limitação reconhecida |
|---|--------------------------|-------------------|----------------------------------|-------------------------------|------------------------|
| **I** | **Finalidade** — propósitos legítimos, específicos, explícitos, informados ao titular | DvP é a única operação suportada pelo `DvPSettlement`. Cada chamada exige propósito explícito (transferência entre 2 partes). | `contracts/DvPSettlement.sol::executeDvP` | `assert(InvalidParties)` se `from == to` ou `from == address(0)` — operação sem propósito definido é rejeitada algoritmicamente | Propósitos múltiplos (e.g., empréstimo, custódia) exigiriam novos circuitos/contratos |
| **II** | **Adequação** — compatibilidade do tratamento com finalidade | Range checks de saldo evitam valores fora de domínio aceitável (u64) | `circuits/solvency_dvp.zok` (uso implícito de field comparisons) | Saldos limitados a 2^253 (BN128 field), com convenção prática de u64 documentada | Convenção, não enforcement criptográfico estrito de range no circuito |
| **III** | **Necessidade** — limitação ao mínimo necessário | Saldos e valor V **nunca** trafegam em plaintext on-chain. Apenas commitments + prova são públicos. | `contracts/PrivateToken.sol:39` (`mapping commitments` em `bytes32`) + `circuits/solvency_dvp.zok` (todas as variáveis de saldo são `private`) | A norma algorítmica do circuito tem `private field S_A, S_B, V` — o compilador ZoKrates **garante** que esses valores nunca aparecem nos public inputs | **Tamanhos de calldata e padrões de timing** podem vazar informação (Ismayilov & Özturan 2023) — ver THREAT_MODEL I2 |
| **IV** | **Livre acesso** — consulta facilitada pelo titular | Titular detém `(value, randomness)` off-chain e pode "abrir" seu commitment a qualquer momento | (Operação off-chain do cliente) | Função `commit(v, r) = Poseidon([v, r])` é determinística — titular sempre pode demonstrar seu saldo a um ente autorizado | Acesso depende de gestão off-chain das randomness pelo cliente |
| **V** | **Qualidade dos dados** — exatidão, clareza, atualização | Conservação de valor é provada criptograficamente: `S_A_new = S_A - V`, `S_B_new = S_B + V` | `circuits/solvency_dvp.zok:88-89` | Predicado de conservação é `assert(commit(S_A_new, r_new) == commit_A_new)` — garantia matemática contra inconsistência contábil | — |
| **VI** | **Transparência** — informações claras sobre tratamento | Eventos públicos (`CommitmentMinted`, `CommitmentUpdated`, `CommitmentShredded`, `DvPSettled`) registram todas as operações sem revelar valores | `contracts/PrivateToken.sol:43-58` (eventos), `contracts/DvPSettlement.sol::DvPSettled` | Eventos contêm endereços + commitments (hashes) — observador externo pode auditar **frequência e topologia** sem ver valores | Conteúdo do "tratamento" (valores) só é transparente para o titular — limitação inerente ao paradigma ZK |
| **VII** | **Segurança** — medidas técnicas e administrativas | Multi-camada: (a) Poseidon (binding+hiding), (b) Groth16 (soundness/completude), (c) AccessControl (role-based), (d) ReentrancyGuard, (e) Rate limiting, (f) BFT consensus | `contracts/DvPSettlement.sol` (todas as 6 camadas), `contracts/PrivateToken.sol:31` (AccessControl) | Cada controle é uma `assert` ou modifier que rejeita execução fora do estado válido | Trusted setup local é vulnerável (ADR-0003) — produção exige cerimônia MPC |
| **VIII** | **Prevenção** — adoção de medidas para prevenir danos | Modelo de ameaças STRIDE com 18 ameaças identificadas, 16 mitigadas | `docs/THREAT_MODEL.md` | Cada categoria STRIDE tem controle técnico associado (e.g., `nonReentrant` para E2; `lastDvPBlock` para D1) | I2 (timing analysis) e E1 (CRS) são riscos residuais documentados |
| **IX** | **Não-discriminação** — vedação de tratamento para fins ilícitos ou abusivos | Operações são **uniformes**: mesmo predicado, mesma prova, mesmo gas para qualquer par de partes | `contracts/DvPSettlement.sol::executeDvP` | Algoritmo é **agnóstico a identidade** — endereços só aparecem como labels, não influenciam aceitação/rejeição | Análise de **padrões agregados** pelo regulador pode revelar discriminação implícita (e.g., DvPs concentrados em determinada região) — controle organizacional necessário |
| **X** | **Responsabilização e prestação de contas** — comprovação de cumprimento | Audit trail dual: (a) blockchain Besu (imutável, multi-validador) + (b) RegulatorViewer com blobs ECIES | `contracts/RegulatorViewer.sol` + eventos QBFT do Besu | `getEncryptedTx` permite ao regulador comprovar conhecimento da operação completa (decifrando o blob) sem comprometer privacidade do titular | Histórico imutável do bloco é tanto força (responsabilização) quanto fraqueza (vs. art. 18, VI — ADR-0005) |

---

## Art. 5º — Definições relevantes

| Inciso | Conceito | Como a PoC opera | Controle técnico |
|---|---|---|---|
| **III** | Dado pessoal sensível | Saldos e padrões de transação podem ser tratados como sensíveis (revelam comportamento financeiro) — tratados sob privacidade reforçada | Todo o stack ZK protege esses dados |
| **XI** | **Anonimização** | Commitment Poseidon torna o valor "criptograficamente irrecuperável" sem (value, randomness). Atende ANPD Guia de Anonimização item 4.3. | `contracts/PrivateToken.sol:39` |

---

## Art. 18 — Direitos do titular

| Inciso | Direito | Como a PoC atende | Controle técnico | Limitação |
|---|---|---|---|---|
| **I** | Confirmação da existência de tratamento | Função `hasCommitment(address)` retorna boolean | `PrivateToken.sol:142` | — |
| **II** | Acesso aos dados | Titular consulta seu commitment via `commitments(address)` e abre off-chain com sua randomness | `PrivateToken.sol:39` | — |
| **III** | Correção de dados incompletos/desatualizados | DvPs subsequentes atualizam o commitment automaticamente | `DvPSettlement.sol::executeDvP` | Não há "correção" de valor incorreto inicial sem operação contábil legítima |
| **IV** | Anonimização, bloqueio ou eliminação de dados desnecessários | `cryptoShred` zera o commitment | `PrivateToken.sol::cryptoShred` | Acionado pelo regulador, não diretamente pelo titular (ver V) |
| **V** | Portabilidade | (Off-chain) titular pode mover (value, randomness) para outro sistema | — | PoC não implementa export padronizado |
| **VI** | **Eliminação** | `cryptoShred` zera o commitment no estado atual (LGPD-compliant via interpretação de "eliminação" como inacessibilidade criptográfica, ADR-0005) | `PrivateToken.sol::cryptoShred` | **Histórico imutável do bloco persiste** — limitação inerente à blockchain. Mitigado pelo fato de eventos não revelarem valores. Discussão completa em `docs/ADR/0005-cryptoshredding-vs-art-18-VI.md`. |
| **VII** | Informação sobre compartilhamento | Eventos `DvPSettled` revelam partes envolvidas | (eventos públicos) | — |
| **VIII** | Informação sobre não-fornecimento e consequências | (Fora do escopo da PoC) | — | Camada de UX/comunicação ao titular |
| **IX** | Revogação de consentimento | Equivalente a `cryptoShred` para fins práticos (após shred, consentimento implícito é encerrado) | `PrivateToken.sol::cryptoShred` | Mesmas limitações do inciso VI |

---

## Art. 46 — Privacidade por Design

> "Os agentes de tratamento devem adotar medidas de segurança, técnicas e administrativas aptas a proteger os dados pessoais."

A PoC inteira **é** uma materialização de Privacidade por Design:

- **Não-coleta**: saldos não entram em plaintext em nenhum momento
- **Pseudonimização forte**: endereços + commitments substituem identidade + valor
- **Defesa em profundidade**: 6 camadas (criptografia, AccessControl, BFT, rate limit, audit trail, crypto-shred)
- **Validação algorítmica**: predicados LGPD são **expressos no circuito** (não dependem de revisão jurídica caso a caso)

Referências cruzadas em `docs/THEORY_CODE_IS_LAW.md` (em construção no M7).

---

## Art. 38 — Relatório de Impacto (RIPD)

A PoC fornece insumos para a redação de um RIPD por uma instituição financeira que adote a tecnologia:

| Item do RIPD | Insumo na PoC |
|---|---|
| Descrição dos tipos de dados | `LGPD_COMPLIANCE.md` (este documento) + `ARCHITECTURE.md` |
| Metodologia de coleta e finalidade | `docs/THEORY_CODE_IS_LAW.md` |
| Análise das medidas, salvaguardas e mecanismos | `docs/THREAT_MODEL.md` + ADRs |
| Avaliação de necessidade e proporcionalidade | Princípio III/V acima |

---

## Limitações declaradas honestamente

| Limitação | Relevância LGPD | Mitigação no escopo PoC |
|---|---|---|
| **Trusted setup local** | Vulnerabilidade do art. 6º VII (segurança) — risco de forja de provas | ADR-0003 + aviso explícito; produção exige cerimônia MPC |
| **Timing analysis** | Vazamento parcial de info (art. 6º III — necessidade) | THREAT_MODEL I2 + plano de batching/padding documentado |
| **Histórico imutável** | Conflito com art. 18, VI | ADR-0005 + crypto-shredding com limitação declarada |
| **Total supply não rastreado** | Auditoria contábil regulatória limitada | PrivateToken.sol comentário linha 30 — produção exigiria range proofs agregados |
| **REGULATOR_ROLE central** | Concentração de poder vs. princípio de minimização | THREAT_MODEL I4 + recomendação de Shamir Secret Sharing 3 de 5 para produção |
| **Padronização de dados** (art. 50) | Não há código de boas práticas formalizado | Trabalho regulatório, não técnico |

---

## Validação cruzada com a literatura

| Fonte | Concordância da PoC |
|---|---|
| **Lopes et al., *Cryptolaw* (Almedina)** | A PoC realiza explicitamente a "convergência entre norma jurídica e norma algorítmica" defendida pela obra (cada `assert` cita o artigo LGPD em comentário) |
| **Burgos & Alchieri (2025)** | Mesmo paradigma DvP em rede permissionada; mesma escolha de Poseidon; mesma arquitetura off/on-chain |
| **IMF Fintech Note 2024/004** | Crypto-shredding como padrão técnico recomendado para CBDCs; PoC adota |
| **ANPD Guia de Anonimização (2024)** | Item 4.3 reconhece anonimização criptográfica; commitment Poseidon se enquadra |
| **Eberhardt & Tai (2018)** | Paradigma off/on-chain replicado fielmente |

---

## Referências

- Lei nº 13.709/2018 — LGPD (texto integral consultado em https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709.htm)
- ANPD (2024). *Guia de Anonimização*. Versão 1.0.
- Lopes, F. et al. *Cryptolaw: Inovação, Direito e Desenvolvimento*. Almedina.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
- IMF Fintech Note 2024/004. *Privacy in CBDC Systems: Technical and Legal Patterns*.
- Doneda, D. (2019). *Da Privacidade à Proteção de Dados Pessoais*. Thomson Reuters.
- Pinheiro, P. P. (2020). *Proteção de Dados Pessoais: Comentários à Lei n. 13.709/2018*. Saraiva.
