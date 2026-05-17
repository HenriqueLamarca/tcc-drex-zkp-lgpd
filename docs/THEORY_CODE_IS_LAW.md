# Code is Law no DREX: Convergência entre Norma Jurídica e Norma Algorítmica

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira | **Período:** 2026/1
> **Âncora teórica:** Lopes, F. et al. *Cryptolaw: Inovação, Direito e Desenvolvimento*. Almedina.

---

## Sumário

1. [Da máxima de Lessig à norma algorítmica do DREX](#1-da-máxima-de-lessig-à-norma-algorítmica-do-drex)
2. [Convergência: o que significa "norma algorítmica"](#2-convergência-o-que-significa-norma-algorítmica)
3. [Análise linha-a-linha do circuito `solvency_dvp.zok`](#3-análise-linha-a-linha-do-circuito-solvency_dvpzok)
4. [Os contratos como tradutores normativos](#4-os-contratos-como-tradutores-normativos)
5. [Sandboxes regulatórios: LIFT Lab, LAB e CRIA](#5-sandboxes-regulatórios-lift-lab-lab-e-cria)
6. [O que o código não resolve sozinho](#6-o-que-o-código-não-resolve-sozinho)
7. [Conclusão e implicações para o piloto DREX](#7-conclusão-e-implicações-para-o-piloto-drex)
8. [Referências](#referências)

---

## 1. Da máxima de Lessig à norma algorítmica do DREX

Lawrence Lessig formulou em *Code and Other Laws of Cyberspace* (1999) a tese de que **"código é lei"** — no ciberespaço, a arquitetura técnica regula comportamentos com a mesma força que normas jurídicas tradicionais. Vinte e cinco anos depois, essa tese encontra sua expressão mais radical nas blockchains permissionadas que sustentam **Central Bank Digital Currencies (CBDCs)**, em particular no projeto piloto do **Drex** conduzido pelo Banco Central do Brasil.

A obra *Cryptolaw: Inovação, Direito e Desenvolvimento* (Lopes et al., Almedina) atualiza esta discussão ao propor o conceito de **"norma algorítmica"** — um corpo de regras computáveis que, ao serem executadas pela máquina, **produzem efeitos jurídicos equivalentes** aos de uma norma legal. Diferente do `Code is Law` de Lessig (descritivo: o código *já é* uma forma de regulação), a norma algorítmica é **prescritiva e intencional**: cabe ao legislador, ao regulador e ao desenvolvedor desenhar o algoritmo de modo que ele *materialize* o conteúdo da norma jurídica.

Esta PoC é um exercício prático dessa convergência. Cada linha do circuito ZoKrates, cada `assert` do contrato Solidity, cada papel de AccessControl, é uma **tradução operacional** de um dispositivo da Lei Geral de Proteção de Dados (Lei 13.709/2018) — não como referência simbólica em comentários, mas como **restrição executiva** que a EVM aplica em cada bloco minerado.

---

## 2. Convergência: o que significa "norma algorítmica"

Para *Cryptolaw*, a convergência entre norma jurídica e norma algorítmica se sustenta em três pilares:

### 2.1. **Indistinguibilidade prática** entre obrigação legal e restrição computacional

Quando o `DvPSettlement` reverte uma transação porque `S_A < V`, não é apenas a aplicação técnica da função de solvência — é a **realização operacional do princípio da necessidade** (LGPD art. 6º, III): o sistema **nega** o tratamento de dados (transferência) que extrapola o que é estritamente necessário (transferir o que se possui).

O efeito jurídico — a operação não acontece — é **idêntico** ao que ocorreria se um analista de compliance tivesse rejeitado a transação manualmente após inspecioná-la. A diferença é que, no algoritmo, **não há discrição interpretativa**: o predicado é binário, determinístico, auditável.

### 2.2. **Auto-execução** sem intermediação interpretativa

O contrato `Verifier.sol` chama `verifyTx(proof, input)` e devolve `true` ou `false`. Não há margem para "interpretação benevolente" da prova. Isso resolve um problema clássico do direito tradicional: a **discricionariedade** que pode ser instrumentalizada para discriminação ou evasão regulatória.

A norma algorítmica é, neste sentido, mais **rígida** que a norma jurídica — o que é simultaneamente sua força (incorruptibilidade) e sua fraqueza (incapacidade de tratar exceções legítimas; ver Seção 6).

### 2.3. **Verificabilidade pública** do cumprimento

Qualquer cidadão pode auditar o `solvency_dvp.zok` no GitHub e **provar matematicamente** que o sistema **não pode** revelar saldos sem comprometer toda a curva BN128 (problema computacional aberto). Compare com a auditoria de um sistema bancário tradicional, que requer SLAs, NDAs, equipes dedicadas e *ainda assim* depende de confiança nos auditores.

A norma algorítmica é **transparente quanto à sua execução** sem precisar ser transparente quanto aos dados — propriedade essencial para CBDCs em jurisdições com leis de proteção de dados rigorosas como a LGPD.

---

## 3. Análise linha-a-linha do circuito `solvency_dvp.zok`

O coração da PoC é o circuito ZK `circuits/solvency_dvp.zok` (108 linhas). Esta seção mapeia **cada `assert`** ao princípio LGPD que ele materializa.

### 3.1. Estrutura geral

```zokrates
def main(
    field commit_A_old, field commit_B_old,
    field commit_A_new, field commit_B_new,        // public inputs
    private field S_A, private field S_B, private field V,
    private field r_A_old, private field r_B_old,
    private field r_A_new, private field r_B_new   // private witness
)
```

A separação entre **public inputs** e **private witness** é, juridicamente, o **operador de minimização** da LGPD art. 6º, III: o que precisa ser visível ao verificador (commitments — hashes inquebráveis) é mínimo; o que não precisa ser visível (saldos, valores, randomness) **simplesmente não é exposto** ao circuito como public input.

A escolha de tipos é **uma escolha legal**. O compilador ZoKrates **garante** — não apenas promete — que `private field S_A` nunca aparecerá nos public inputs nem na prova final.

### 3.2. Passo 1 — Abertura dos commitments antigos

```zokrates
assert(commit(S_A, r_A_old) == commit_A_old);
assert(commit(S_B, r_B_old) == commit_B_old);
```

**Norma jurídica materializada:** **LGPD art. 6º, VI (transparência)**.

Estas duas linhas implementam algoritmicamente o que o art. 6º, VI determina: o controlador deve poder **demonstrar** que o tratamento dos dados é consistente, sem necessariamente revelar o conteúdo.

A propriedade de **binding** do Poseidon impede que A "minta" sobre seu saldo (não consegue produzir nova abertura para o mesmo commitment). A propriedade de **hiding** mantém o saldo em sigilo. Juntas, materializam um conceito que no direito tradicional exige um *ente confiável* (auditor independente): **demonstração sem divulgação**.

### 3.3. Passo 2 — Não-trivialidade da operação

```zokrates
assert(V != 0);
```

**Norma jurídica materializada:** **LGPD art. 6º, III (necessidade)** + **art. 6º, I (finalidade)**.

Operações sem propósito real (V = 0) são **rejeitadas pelo algoritmo**. Não há "transferência simbólica" ou ruído transacional. Cada uso do sistema deve ter justificativa econômica — espelhando a exigência jurídica de que o tratamento de dado pessoal tenha **finalidade legítima e específica**.

Esta linha é a **objeção computacional** ao tratamento abusivo: o sistema simplesmente **não permite** que dados sejam processados sem propósito.

### 3.4. Passo 3 — Solvência (predicado central)

```zokrates
assert(S_A >= V);
```

**Norma jurídica materializada:** **LGPD art. 6º, III (necessidade)** + análoga do **Código Civil Brasileiro art. 422 (boa-fé objetiva)**.

A solvência é o **predicado central de Burgos & Alchieri (2025)**: o pagamento só é aceito se quem paga *de fato* tem o que pagar. No direito civil, é o princípio que sustenta a validade de qualquer obrigação pecuniária — `nemo dat quod non habet` (ninguém dá o que não tem).

O assert eleva esse princípio à categoria de **lei executiva da rede**: nenhum validador QBFT pode incluir uma DvP sem solvência, mesmo que conluiado com o pagador. A norma é fiscalizada pelos próprios precompileds da EVM (BN128 ECPAIRING) — uma "fiscalização sem fiscal".

### 3.5. Passo 4 — Conservação de valor

```zokrates
field S_A_new = S_A - V;
field S_B_new = S_B + V;
```

**Norma jurídica materializada:** **LGPD art. 6º, V (qualidade dos dados)** + **LGPD art. 6º, VII (segurança)**.

A conservação garante **integridade contábil** sem auditor humano. Em sistemas tradicionais, esta propriedade depende de:
- Reconciliação periódica entre extratos
- Auditoria contábil anual
- Confiança nos sistemas core do banco

Aqui, ela é **invariante matemática**: a soma não pode mudar, sob pena de invalidar a prova Groth16. A "qualidade dos dados" exigida pela LGPD é **provada criptograficamente** a cada bloco minerado.

### 3.6. Passo 5 — Abertura dos commitments novos

```zokrates
assert(commit(S_A_new, r_A_new) == commit_A_new);
assert(commit(S_B_new, r_B_new) == commit_B_new);
```

**Norma jurídica materializada:** **LGPD art. 5º, XI (anonimização)** + **art. 6º, VII (segurança)**.

A randomness `r_*_new` é amostrada criptograficamente do lado do cliente para **manter o hiding** dos novos saldos. Sem isso, um observador poderia brute-forçar o novo commitment a partir do antigo (sabendo que mudou em V).

A norma de **anonimização** do art. 5º, XI da LGPD não exige a destruição do dado — exige que seja **inacessível** sem informação adicional. Aqui, a informação adicional é (`new_value`, `new_randomness`), conhecida apenas pelo titular.

A ANPD reconhece esse padrão no **Guia de Anonimização (2024), item 4.3**: dado criptograficamente protegido em que a chave/randomness é gerenciada pelo titular **deve ser tratado como anonimizado** para fins legais.

---

## 4. Os contratos como tradutores normativos

O circuito é apenas a metade ZK. A outra metade — os contratos Solidity — traduz princípios LGPD em **mecanismos de governança e access control**.

### 4.1. `PrivateToken` — armazenamento conforme o art. 5º, XI

```solidity
mapping(address account => bytes32 commitment) public commitments;
```

Não há `uint256 balance`. A tipagem é **uma escolha jurídica**: o storage do token nunca contém saldo — apenas commitments hashed. Isso **antecipa** uma eventual fiscalização da ANPD sobre o data minimization no DREX: se o regulador questionar "que dados pessoais são armazenados?", a resposta é "**hashes Poseidon — anonimizados conforme art. 5º, XI da LGPD e item 4.3 do Guia ANPD 2024**."

### 4.2. `cryptoShred` — interpretação técnica do art. 18, VI

A função `cryptoShred(address)` materializa uma **interpretação técnica** do direito de eliminação:

```solidity
function cryptoShred(address account) external onlyRole(REGULATOR_ROLE) {
    bytes32 last = commitments[account];
    if (last == bytes32(0)) revert CommitmentNotFound(account);
    commitments[account] = bytes32(0);
    emit CommitmentShredded(account, last);
}
```

A doutrina jurídica brasileira (Pinheiro 2020; Doneda 2019) admite que **eliminação** pode significar inacessibilidade criptográfica. A função opera nessa interpretação:
- O estado atual perde toda referência ao titular
- Os eventos passados permanecem no histórico imutável (limitação inerente da blockchain) — mas como contêm apenas hashes, **não revelam dados pessoais**
- A função é restrita ao `REGULATOR_ROLE` para evitar shred indevido por terceiros

A discussão completa, com referência a IMF Fintech Note 2024/004, está em [`docs/ADR/0005-cryptoshredding-vs-art-18-VI.md`](ADR/0005-cryptoshredding-vs-art-18-VI.md).

### 4.3. `RegulatorViewer` — espelho da LC 105/2001

A Lei Complementar 105/2001 regula o **sigilo bancário** no Brasil: os bancos devem manter sigilo, mas devem permitir acesso a autoridades competentes mediante critério legal.

`RegulatorViewer` traduz esse arranjo:
- Cidadão comum: vê apenas metadados (`getTxMetadata`) — partes envolvidas e bloco
- Regulador (REGULATOR_ROLE): vê o conteúdo cifrado (`getEncryptedTx`), decifra off-chain com sua chave privada

Não é um arranjo de "vigilância total" — é exatamente o equilíbrio que a LC 105/2001 estabelece para o sistema bancário tradicional. A diferença é que **aqui o equilíbrio é garantido pela criptografia, não por um termo de cooperação interinstitucional**.

### 4.4. `DvPSettlement` — atomicidade como princípio jurídico

```solidity
function executeDvP(...) external nonReentrant returns (uint256 txId) {
    // ... validações ...
    bool valid = verifier.verifyTx(proof, inputArr);
    if (!valid) revert InvalidProof();
    token.setCommitment(from, fromNew);
    token.setCommitment(to, toNew);
    txId = regulatorViewer.recordTx(from, to, encryptedBlob);
    emit DvPSettled(txId, from, to, ...);
}
```

A **atomicidade** da transação (ou tudo acontece, ou nada) é mais que uma propriedade técnica — é a materialização do princípio da **boa-fé objetiva** (Código Civil art. 422): nenhuma das partes pode ser deixada em estado intermediário onde uma "pagou" e a outra "ainda não recebeu".

No direito tradicional, isso depende de confiança no intermediário (banco central, clearing house). Aqui, **a EVM é o intermediário** — e ela executa todas as operações sob lock do mesmo bloco, ou desfaz tudo em caso de revert. **A boa-fé é garantida pelo consenso QBFT**.

---

## 5. Sandboxes regulatórios: LIFT Lab, LAB e CRIA

A convergência entre norma jurídica e norma algorítmica não acontece no vácuo. Ela exige **espaços institucionais** onde inovação técnica e evolução normativa conversem. No Brasil, três sandboxes desempenham este papel para o sistema financeiro:

### 5.1. **LIFT Lab (BCB)** — Laboratório de Inovações Financeiras e Tecnológicas

O LIFT Lab é a **iniciativa estruturante** do BCB para o desenvolvimento do DREX. É onde a escolha do **Hyperledger Besu** com consenso **QBFT** foi tomada (vide ADR-0002), onde os critérios de privacidade do DREX foram debatidos com fintechs e onde experimentos com ZKP foram conduzidos antes da decisão pelo piloto público.

A PoC se posiciona como uma **contribuição metodológica** ao tipo de trabalho que o LIFT Lab realiza: não substitui suas decisões, mas oferece um **template reproduzível** de como traduzir LGPD em arquitetura técnica.

### 5.2. **LAB (BCB Inovação Financeira)** — Sandbox Regulatório

O LAB é o sandbox onde **instituições financeiras autorizadas** podem testar produtos inovadores em ambiente controlado, sob supervisão do BCB. Para uma instituição que adotasse esta PoC como base de um produto privado complementar ao DREX (e.g., transferências B2B com privacidade reforçada), o LAB seria o caminho natural de validação regulatória.

A documentação dos ADRs (0001–0005), do `THREAT_MODEL.md` e desta análise teórica fornece **toda a base de defesa regulatória** que o BCB exigiria em uma admissão ao LAB.

### 5.3. **CRIA (CVM)** — Centro Regulatório para Inovação Aplicada

O CRIA, da CVM, é o equivalente do LAB para o mercado de capitais. Como a aplicação natural do DREX inclui **liquidação de ativos** (TVM tokenizados, LCAs digitais, etc.), uma extensão da PoC para um caso de uso de mercado de capitais (e.g., DvP de cotas de FIIs entre investidores institucionais com privacidade) caberia tipicamente em uma admissão ao CRIA.

### 5.4. Convergência institucional

Os três sandboxes (LIFT Lab, LAB, CRIA) operam sob lógicas distintas mas convergentes: **dar legitimidade institucional à norma algorítmica**. A PoC, ao explicitar cada decisão técnica como tradução de uma norma jurídica, **se torna mais facilmente admissível** em qualquer um desses ambientes — pois oferece a "trilha de auditoria conceitual" que reguladores buscam.

---

## 6. O que o código não resolve sozinho

A convergência entre norma jurídica e norma algorítmica tem **limites estruturais** que devem ser declarados honestamente. O **IMF Fintech Note 2024/004** (*Privacy in CBDC Systems: Technical and Legal Patterns*) sintetiza estes limites em três grupos:

### 6.1. Definição de controlador e operador em rede multi-institucional

A LGPD, no art. 5º, VI–VII, distingue **controlador** (quem decide finalidades) e **operador** (quem trata os dados em nome do controlador). Em uma rede como o DREX, com 4+ validadores institucionais (BCB, bancos comerciais, FinTechs), **quem é o controlador?**

O código não responde isto. A resposta exige:
- Acordo interinstitucional formal (ANPD pode mediar)
- Definição de papéis no termo de adesão ao DREX
- Regimes de responsabilização cruzada (em caso de vazamento, qual instituição responde?)

A PoC **viabiliza** esta discussão ao deixar claro que tecnicamente todos os validadores veem a mesma coisa (commitments + provas), mas **não decide** quem é controlador. Isso é trabalho regulatório, não técnico.

### 6.2. Accountability legal além da imutabilidade técnica

A blockchain é imutável — mas e quanto à **responsabilidade civil** por uma DvP fraudulenta? Se Alice é vítima de phishing e atacante usa seu device para emitir uma DvP válida, o código não pode reverter. **O direito** precisa intervir.

Mecanismos a serem definidos pelo legislador:
- Equivalente à **redirect chargeback** dos cartões de crédito (e.g., janela de 30 dias para contestação)
- **Seguro obrigatório** para usuários institucionais
- **Câmara de arbitragem** específica para disputas DvP

A PoC é compatível com qualquer um destes mecanismos (basta adicionar contratos extra), mas **não os implementa** — pois cada um tem implicações jurídicas que exigem deliberação.

### 6.3. Jurisdição em rede transnacional

O DREX é nacional, mas se interconectar com outras CBDCs (mBridge, Helvetia), surgem questões de **jurisdição cruzada**:
- LGPD se aplica a transações entre Alice (BR) e Bob (CH)?
- Como o regulador suíço acessa audit trail cifrado para chave do BCB?
- Que lei rege o crypto-shredding em cooperação?

O IMF Fintech Note 2024/004 dedica todo seu Capítulo 6 a este tema. A PoC adota a arquitetura mais **conservadora**: tudo nacional, regulador único. Para multi-jurisdição, seria necessário **selective disclosure ZKP** (mencionado em ADR-0004 como trabalho futuro) e acordos de **mutual legal assistance** atualizados para o paradigma criptográfico.

---

## 7. Conclusão e implicações para o piloto DREX

Este TCC sustenta a tese de que a **convergência entre norma jurídica e norma algorítmica é viável, defensável e necessária** para a privacidade no DREX. A PoC oferece três contribuições mensuráveis:

### 7.1. Demonstração técnica

A combinação ZoKrates + Groth16 + Hyperledger Besu **funciona** e atende aos NFRs estabelecidos:
- **Tempo de prova:** ~2 segundos (RNF01: < 30s) — 15× melhor
- **Gas de verificação:** 264.020 (RNF02: < 300.000) — 12% folga
- **Cobertura de testes:** 100% statements (RNF03: ≥ 80%)
- **Reproducibilidade:** `make all` em < 10 minutos (RNF04)
- **Logs sem plaintext:** validado programaticamente (RNF06)

### 7.2. Tradução jurídica rastreável

Cada controle técnico tem referência cruzada com:
- Artigo da LGPD (matriz em `LGPD_COMPLIANCE.md`)
- Decisão arquitetural justificada (ADRs 0001–0005)
- Categoria STRIDE (THREAT_MODEL.md)
- Análise teórica (este documento)

Esta cadeia de rastreabilidade é o que **diferencia uma PoC acadêmica de um proof-of-concept comercial**: não basta funcionar; é preciso explicar **por que** cada decisão foi tomada e **como** ela se relaciona com o ordenamento jurídico vigente.

### 7.3. Insumo para o BCB e a comunidade DREX

A PoC pode ser oferecida como:
- **Material de discussão** em foros do LIFT Lab
- **Template de admissão** ao LAB ou CRIA para instituições interessadas
- **Material de aula** em cursos de regulação financeira e direito digital
- **Base** para extensões acadêmicas (selective disclosure, multi-jurisdição, integração com mBridge)

### 7.4. Norma algorítmica como linguagem comum

A maior contribuição conceitual deste TCC é mostrar que a **norma algorítmica pode ser uma linguagem comum** entre desenvolvedores, juristas e reguladores. Quando a `assert(S_A >= V)` é também uma materialização do art. 6º, III da LGPD e do art. 422 do Código Civil, todos os três grupos têm o que dizer sobre ela — e o **diálogo é possível porque o objeto é o mesmo**.

A obra *Cryptolaw* (Almedina) defende esta convergência em termos abstratos. Esta PoC oferece um **exemplo executável** de como ela se manifesta na prática, no domínio mais sensível do sistema financeiro brasileiro: **o dinheiro do cidadão, o sigilo bancário e a moeda emitida pelo Banco Central**.

---

## Referências

### Doutrina jurídica brasileira

- **Lei nº 13.709/2018** — Lei Geral de Proteção de Dados Pessoais (LGPD).
- **Lei Complementar nº 105/2001** — Sigilo das operações de instituições financeiras.
- **Código Civil Brasileiro** (Lei 10.406/2002) — art. 422 (boa-fé objetiva).
- **ANPD (2024)**. *Guia de Anonimização*. Versão 1.0. Brasília.
- **Doneda, D. (2019)**. *Da Privacidade à Proteção de Dados Pessoais: fundamentos da Lei Geral de Proteção de Dados*. Thomson Reuters Brasil.
- **Pinheiro, P. P. (2020)**. *Proteção de Dados Pessoais: Comentários à Lei n. 13.709/2018*. Saraiva.
- **Lopes, F. et al.** *Cryptolaw: Inovação, Direito e Desenvolvimento*. Almedina.

### Teoria do "Code is Law" e regulação algorítmica

- **Lessig, L. (1999)**. *Code and Other Laws of Cyberspace*. Basic Books.
- **Lessig, L. (2006)**. *Code: Version 2.0*. Basic Books.
- **De Filippi, P. & Wright, A. (2018)**. *Blockchain and the Law: The Rule of Code*. Harvard University Press.

### Documentos institucionais (BCB, ANPD, IMF)

- **Banco Central do Brasil**. *Real Digital — DREX: Documentos técnicos do piloto*. https://www.bcb.gov.br/estabilidadefinanceira/drex
- **BCB/LIFT Lab**. Relatórios públicos sobre arquitetura do DREX.
- **CVM/CRIA**. *Sandbox Regulatório: Marco normativo*.
- **IMF Fintech Note 2024/004**. *Privacy in CBDC Systems: Technical and Legal Patterns*.

### Literatura técnica de referência (citada nos ADRs)

- **Eberhardt, J. & Tai, S. (2018)**. *On or Off the Blockchain? Insights on Off-Chaining Computation and Data*. ESOCC.
- **Burgos, D. & Alchieri, E. (2025)**. *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
- **Ismayilov, A. & Özturan, C. (2023)**. *Privacy Attacks on ZKP-Based Token Transfer Protocols*.
- **Groth, J. (2016)**. *On the Size of Pairing-Based Non-interactive Arguments*. EUROCRYPT 2016.
- **Grassi, L. et al. (2021)**. *Poseidon: A New Hash Function for Zero-Knowledge Proof Systems*. USENIX Security.

### Documentos internos da PoC (rastreabilidade)

- [`README.md`](../README.md) — visão geral e instruções de reprodução
- [`PLAN.md`](../PLAN.md) — divisão em marcos M1–M7
- [`docs/LGPD_COMPLIANCE.md`](LGPD_COMPLIANCE.md) — matriz princípio LGPD ↔ controle técnico
- [`docs/THREAT_MODEL.md`](THREAT_MODEL.md) — STRIDE com 18 ameaças
- [`docs/ARCHITECTURE.md`](ARCHITECTURE.md) — descrição dos componentes
- [`docs/REPRODUCIBILITY.md`](REPRODUCIBILITY.md) — guia de reprodução em < 10 min
- [`docs/DEMO_SCRIPT.md`](DEMO_SCRIPT.md) — roteiro de demonstração
- [`docs/ADR/`](ADR/) — registros de decisões arquiteturais (0001–0005)
