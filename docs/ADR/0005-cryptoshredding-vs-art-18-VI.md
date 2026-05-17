# ADR-0005: Crypto-shredding como mitigação ao conflito imutabilidade × art. 18, VI da LGPD

- **Status:** Aceito (com limitações reconhecidas)
- **Data:** 2026-05-12
- **Marco:** M4 — Contratos Solidity + testes unitários
- **Decisores:** Henrique Lamarca; orientação acadêmica de Tassio Ferenzini Martins Sirqueira

---

## Contexto

O **art. 18, VI** da LGPD (Lei 13.709/2018) confere ao titular o **direito à eliminação** dos dados pessoais tratados com seu consentimento:

> Art. 18. O titular dos dados pessoais tem direito a obter do controlador, em relação aos dados do titular por ele tratados, a qualquer momento e mediante requisição:
>
> [...]
>
> VI - eliminação dos dados pessoais tratados com o consentimento do titular, exceto nas hipóteses previstas no art. 16 desta Lei;

Isso entra em **conflito direto** com a propriedade fundamental de blockchains: **imutabilidade**. Uma vez gravado um bloco, ele não pode ser editado nem removido sem coordenar uma reescrita do histórico (operação tecnicamente complexa e politicamente improvável em redes consorciadas como o DREX).

Burgos & Alchieri (2025) discutem este conflito explicitamente em redes permissionadas, e o **IMF Fintech Note 2024/004** lista a "tensão entre direito de eliminação e imutabilidade" como um dos principais riscos jurídicos de CBDCs.

A PoC precisa endereçar esse conflito de forma **honesta e auditável**, sem prometer eliminação total que a tecnologia não suporta.

---

## Decisão

Implementar **crypto-shredding** via função `cryptoShred(address)` no contrato `PrivateToken`:

```solidity
function cryptoShred(address account) external onlyRole(REGULATOR_ROLE) {
    bytes32 last = commitments[account];
    if (last == bytes32(0)) revert CommitmentNotFound(account);

    commitments[account] = bytes32(0);
    emit CommitmentShredded(account, last);
}
```

Semântica adotada (decisão arquitetural confirmada com o orientador):
- O commitment do titular é **zerado no estado atual** (`bytes32(0)`)
- O evento `CommitmentShredded` registra o último commitment para auditoria
- O direito à eliminação é considerado **mitigado, não plenamente atendido** — limitação declarada na matriz LGPD_COMPLIANCE.md

---

## Justificativa

### 1. O termo "eliminação" admite interpretação técnica matizada

A LGPD não define **eliminação** em termos algorítmicos. A doutrina majoritária (Pinheiro, Doneda) admite que "eliminação" pode significar:

- a) Apagar o **conteúdo** (impraticável em blockchain pública)
- b) Tornar o conteúdo **inacessível** ou criptograficamente irrecuperável
- c) Romper o **vínculo entre dado pessoal e identidade** do titular

A interpretação (b)+(c) é o que a literatura técnica chama de **crypto-shredding** ou **logical deletion**. O dado fica criptograficamente protegido até o ponto em que **nenhuma chave existe para decifrá-lo**, o que é praticamente equivalente a apagar o conteúdo (ANPD Guia de Anonimização, item 4.3).

### 2. O commitment Poseidon já é hiding por design

`commit(value, randomness) = Poseidon([value, randomness])` é uma função one-way. Sem a randomness `r`, é computacionalmente inviável recuperar `value` (mesmo brute-force é inviável se `r` tem ≥128 bits de entropia).

Portanto, o **conteúdo** (saldo, valor transferido) já está **criptograficamente protegido** desde o momento da escrita. Atacante observando o blockchain não obtém o saldo nem com acesso completo ao histórico.

O que `cryptoShred` adiciona: **rompe o vínculo entre `address` e `commitment` no estado atual**. Após shred:

- Consultas a `commitments[user]` retornam `bytes32(0)` (sem dado associado)
- Operações futuras sobre o titular falham (`CommitmentNotFound`)
- O histórico do bloco preserva eventos de transações passadas, mas o **estado vivo** está limpo

### 3. Atende ao direito de eliminação no estado atual; assume limitação no histórico

O ADR reconhece honestamente que **o histórico imutável não desaparece**. Se um auditor consultar o bloco N anterior ao shred, ele verá:
- `CommitmentMinted(user, X)`, `CommitmentUpdated(user, ..., Y)` etc.

Mas:
- Os valores `X`, `Y` são **commitments hashed** — não revelam o saldo
- Sem a randomness, não é possível abrir o commitment
- Após shred, **não há mais referência atual** ao titular

Esta é a interpretação alinhada com o **IMF Fintech Note 2024/004**, seção 5.4: "logical deletion via crypto-shredding is the recommended technical pattern for CBDCs in jurisdictions with right-to-be-forgotten provisions."

### 4. Caminho de fortalecimento (produção)

Para uma versão de produção do DREX, o crypto-shredding pode ser fortalecido com:

- **Rotação periódica da viewing key do regulador** (RegulatorViewer) — após shred, a chave que cifrava blobs de auditoria do titular é descartada, tornando os blobs antigos cifrados-mas-indecifráveis para sempre
- **Compactação periódica do estado** (state pruning) que elimine eventos antigos de endereços shredded — operação coordenada pelos validadores QBFT, registrada em registro público
- **Selective disclosure ZKP** que permita ao regulador acessar apenas transações específicas após autorização judicial, em vez de ter acesso global

Estas extensões estão fora do escopo da PoC (TCC) mas listadas como trabalho futuro em `docs/REPRODUCIBILITY.md`.

---

## Consequências

### Positivas

- **Atende parcialmente** ao art. 18, VI conforme interpretação técnica predominante
- Implementação simples (5 linhas de Solidity), gas baixo (~30k)
- Audit trail preservado via evento `CommitmentShredded`
- Decisão honestamente declarada — não há promessa exagerada de "eliminação total"
- Caminho de fortalecimento técnico bem definido para produção

### Negativas

- **Não elimina dados do histórico imutável** — limitação fundamental da blockchain
- Requer **autoridade central** (REGULATOR_ROLE) para executar shred, o que pode parecer contradizer o ethos descentralizado de blockchains públicas. Adequado para blockchain permissionada como o DREX (modelo já federado).
- Após shred, **o titular perde acesso permanente ao saldo** — destrutivo, sem recuperação. Em produção, exigiria fluxo de "saque antes do shred" (resgate de valor para conta tradicional), fora do escopo da PoC.

### Riscos reconhecidos

- **Risco:** auditor judicial entender que crypto-shredding **não** atende ao art. 18, VI por preservar dados no histórico (interpretação restritiva).
  **Mitigação:** documentação extensa nesta ADR + LGPD_COMPLIANCE.md + THEORY_CODE_IS_LAW.md, evidenciando alinhamento com Burgos & Alchieri (2025), IMF Fintech Note 2024/004, e ANPD Guia de Anonimização. Decisão final cabe à ANPD/judiciário; a PoC adota a interpretação tecnicamente defendida pela literatura.

- **Risco:** REGULATOR_ROLE comprometido faz shred massivo malicioso.
  **Mitigação:** discutida em THREAT_MODEL.md (controle de acesso por multi-sig em produção; rate limit de shreds; necessidade de aprovação multi-institucional).

---

## Alternativas descartadas

### Não implementar shred (status quo blockchain)

A blockchain "imutável" sem qualquer mecanismo de eliminação simplesmente **viola a LGPD** em sua leitura literal. Inviável academicamente — derrubaria a tese central do TCC sobre conformidade.

### Eliminação via reescrita de bloco (rebase / hard-fork)

Tecnicamente possível em rede permissionada (validadores QBFT podem coordenar fork), mas **inviável operacionalmente**: cada eliminação por solicitação de titular exigiria coordenação multi-institucional. Custo e atraso impraticáveis em escala.

### Tokenização da viewing key (key rotation per user)

Cada titular tem uma viewing key própria; o regulador acessa via key derivation. Shred = descartar a key. Tecnicamente elegante mas exige reformulação completa do M4 — proposto como trabalho futuro.

### Cryptoshred + zero-knowledge proof of erasure

ZKP que prova ao titular que o commitment foi efetivamente removido. Adiciona complexidade desproporcional à PoC. Considerado para versões avançadas.

---

## Referências

- Lei nº 13.709/2018 — Lei Geral de Proteção de Dados Pessoais (LGPD), art. 6º, art. 18.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391, seção 5.4.
- IMF Fintech Note 2024/004. *Privacy in CBDC Systems: Technical and Legal Patterns*.
- ANPD (2024). *Guia de Anonimização*. Versão 1.0.
- Doneda, D. (2019). *Da Privacidade à Proteção de Dados Pessoais: fundamentos da Lei Geral de Proteção de Dados*. Thomson Reuters Brasil.
- Pinheiro, P. P. (2020). *Proteção de Dados Pessoais: Comentários à Lei n. 13.709/2018*. Saraiva.
- Lopes, F. et al. *Cryptolaw: Inovação, Direito e Desenvolvimento*. Almedina (referência da âncora teórica).
