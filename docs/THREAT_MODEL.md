# Modelo de Ameaças (STRIDE) — PoC DREX-ZKP-LGPD

> **TCC** — Privacidade em Sistemas Financeiros Distribuídos: Uso de Zero-Knowledge Proofs e Smart Contracts para Conformidade com a LGPD
> **Autor:** Henrique Lamarca | **Orientador:** Tassio Ferenzini Martins Sirqueira | **Período:** 2026/1

---

## Escopo do modelo

Este documento aplica o framework **STRIDE** (Microsoft, 2007) à PoC, cobrindo as 6 categorias canônicas: **S**poofing, **T**ampering, **R**epudiation, **I**nformation Disclosure, **D**enial of Service, **E**levation of Privilege.

A análise considera o **trust boundary** completo:

```
┌──────────────────────────────────────────────────────────────────────┐
│  Cliente (Off-chain)                                                 │
│   - Detentor de (saldo, randomness)                                  │
│   - Gera prova Groth16 via ZoKrates                                  │
│   - Cifra blob ECIES para regulador                                  │
└───────────────────────────┬──────────────────────────────────────────┘
                            │ JSON-RPC
┌───────────────────────────▼──────────────────────────────────────────┐
│  Rede Hyperledger Besu (4 validadores QBFT)                          │
│   - PrivateToken: armazena commitments                               │
│   - DvPSettlement: orquestra DvP atomico                             │
│   - RegulatorViewer: armazena ciphertexts                            │
│   - Verifier: valida prova on-chain (precompileds BN128)             │
└──────────────────────────────────────────────────────────────────────┘
                            │
┌───────────────────────────▼──────────────────────────────────────────┐
│  Regulador (Off-chain)                                               │
│   - Detentor de chave privada ECIES                                  │
│   - Decifra blobs do RegulatorViewer                                 │
└──────────────────────────────────────────────────────────────────────┘
```

**Atores considerados:** detentor honesto de saldo, detentor malicioso, observador externo da rede, validador comprometido, regulador legítimo, regulador comprometido, atacante de rede passivo, atacante de rede ativo.

**Fora do escopo:** ataques físicos a hardware dos validadores; ataques side-channel ao trusted setup (cobertos em ADR-0003); engenharia social contra detentores de chaves privadas.

---

## S — Spoofing (Falsificação de identidade)

### S1. Falsificação de identidade dentro da rede Besu QBFT

**Cenário:** atacante tenta participar como validador sem credenciais.

**Impacto:** alto — comprometeria o consenso BFT.

**Mitigação:**
- Rede **permissionada**: `besu-network/init.sh` gera 4 chaves pré-aprovadas; validadores fora dessa lista são rejeitados pelo protocolo QBFT no handshake
- Genesis (`networkFiles/genesis.json`) contém o `extraData` RLP com os endereços dos validadores aprovados; alterá-lo invalida a chain
- Em produção, BCB controlaria a admissão de validadores via processo regulatório formal

**Status:** **Mitigado** pela arquitetura QBFT permissionada (ADR-0002).

---

### S2. Falsificação de identidade do regulador via REGULATOR_ROLE

**Cenário:** atacante consegue obter o `REGULATOR_ROLE` em `RegulatorViewer` ou `PrivateToken` sem autorização.

**Impacto:** crítico — atacante decifraria audit trail (`getEncryptedTx`) e poderia executar `cryptoShred` em saldos legítimos.

**Mitigação:**
- AccessControl da OpenZeppelin: o papel só é concedido por `DEFAULT_ADMIN_ROLE`, garantido por `_grantRole` no constructor
- **Demonstrador de produção implementado:** `contracts/RegulatorMultiSig.sol` substitui a EOA única do REGULATOR_ROLE por uma multi-sig N-of-M. Os testes (`test/unit/RegulatorMultiSig.spec.ts`) provam que o multisig **consegue executar `cryptoShred`** quando atinge o threshold (2-of-3 no exemplo) e **falha** com apenas uma assinatura. Para usar em produção: deploy do `RegulatorMultiSig`, depois `token.grantRole(REGULATOR_ROLE, multisig.address)` em vez de uma EOA
- Em produção (extensões não-implementadas):
  - **Time-lock** de 7 dias antes da execução, permitindo veto por minoria
  - **Rotação de membros** via meta-governança (proposta do próprio multisig sobre si mesmo)
  - **Auditoria pública** via evento `RoleGranted` (já emitido pela OZ AccessControl) + eventos do multisig

**Status:** **Mitigado** + demonstrador de produção funcional no repositório.

---

### S3. Falsificação da identidade do pagador (`from`) em `executeDvP`

**Cenário:** Carlos submete uma transação alegando ser Alice (passa `from = alice.address`).

**Impacto:** baixo — a transação é **assinada por Carlos** (msg.sender = Carlos), mas o contrato verifica se `commitments[alice]` bate com `commit_A_old` da prova. Como Carlos não conhece a randomness de Alice, ele **não consegue gerar prova válida** para os commitments de Alice.

**Mitigação:**
- A propriedade de **binding** do commitment Poseidon impede a forja
- A prova Groth16 é vinculada ao knowledge dos witnesses privados, que só Alice possui

**Status:** **Mitigado** pela criptografia.

---

## T — Tampering (Adulteração de dados)

### T1. Adulteração da prova Groth16 em trânsito

**Cenário:** atacante intercepta o JSON-RPC e modifica `proof.a`, `proof.b` ou `proof.c` antes do `executeDvP`.

**Impacto:** baixo — `Verifier.verifyTx` rejeita a prova adulterada (validado em `DvPSettlement.spec.ts` cenário "InvalidProof").

**Mitigação:**
- A integridade vem do esquema Groth16: qualquer mudança bit-a-bit em a/b/c invalida o pareamento bilinear
- TLS opcional no JSON-RPC (não é parte do protocolo, mas pode ser configurado em produção)

**Status:** **Mitigado** pela criptografia.

---

### T2. Adulteração do circuito `solvency_dvp.zok` antes do deploy

**Cenário:** desenvolvedor malicioso modifica o circuito (e.g., remove `assert(S_A >= V)`), recompila, e gera novo Verifier.sol.

**Impacto:** crítico — pagamentos sem solvência seriam aceitos.

**Mitigação:**
- `make zkp:setup` regenera Verifier.sol a partir do .zok no momento do build
- Para detecção, recomenda-se:
  - **Hash do .zok** registrado em ADR-0003 + commit do hash do `circuits/proving_key/verification.key` no `Verifier.sol` deployado
  - Revisão de código obrigatória (PR) em qualquer alteração de `circuits/`
  - **Auditoria de circuito** por terceiro (e.g., Trail of Bits, Veridise) antes de produção

**Status:** **Mitigação parcial** na PoC; auditoria de circuito é pré-requisito de produção.

---

### T3. Adulteração de `commitments` em `PrivateToken`

**Cenário:** atacante tenta sobrescrever `commitments[alice]` direta ou indiretamente.

**Impacto:** crítico se viável.

**Mitigação:**
- Storage só pode ser modificado via `setCommitment`, restrito a `SETTLEMENT_ROLE`
- Apenas `DvPSettlement` recebe esse papel no deploy (`scripts/04_deploy.ts`)
- Validado em `PrivateToken.spec.ts` ("revert se chamado sem SETTLEMENT_ROLE")
- Solidity 0.8 + viaIR: sem stack/storage corruption

**Status:** **Mitigado** pelo modelo de papéis.

---

## R — Repudiation (Não-repudiação)

### R1. Pagador alega que não submeteu a transação DvP

**Cenário:** Alice nega ter executado uma DvP que aparece no histórico.

**Impacto:** baixo — todas as transações na blockchain Besu são assinadas pela chave privada do remetente; o consenso QBFT garante imutabilidade.

**Mitigação:**
- Assinatura ECDSA do remetente é registrada na transação
- 4 validadores assinaram o bloco que contém a transação
- Trail de auditoria adicional no `RegulatorViewer` (txCount, blockNumber, timestamp, partes)
- Evento `DvPSettled` emite `txId`, `from`, `to`

**Status:** **Mitigado** pela arquitetura blockchain + validators.

---

### R2. Regulador acessa audit trail e nega ter acessado

**Cenário:** regulador decifra um blob ECIES e depois nega ter feito a leitura (auditoria de quem viu o quê).

**Impacto:** médio — relevante para LC 105/2001 (sigilo bancário com responsabilidade do agente).

**Mitigação (implementada):**
- `RegulatorViewer.accessEncryptedTx(txId)` é a **via canônica** de acesso do
  regulador: muda estado e **emite o evento `RegulatorAccessed(txId, regulator,
  timestamp)`**, criando trilha **imutável on-chain** de quem acessou o quê e
  quando. O regulador não pode negar a consulta.
- Validado em `RegulatorViewer.spec.ts` (emite evento, cria recibo, restrito a
  `REGULATOR_ROLE`) e exercido no cenário `scripts/05_run_dvp_demo.ts`.
- Materializa a responsabilização da LGPD art. 6º, X e o regime de
  responsabilidade do agente da LC 105/2001.

**Limitação residual reconhecida:**
- `getEncryptedTx` (view, sem rastro) permanece como conveniência de inspeção
  off-chain; seu uso é governado por política interna. O procedimento
  institucional **deve** usar `accessEncryptedTx`. Remover totalmente a view
  fecharia esse resíduo, mas reduziria a ergonomia de inspeção — decisão
  consciente, no mesmo espírito honesto do ADR-0005.
- Reforço de produção: MFA off-chain antes da decifração + logging no sistema
  de auditoria interno do regulador.

**Status:** **Mitigado** — via auditável on-chain implementada; resíduo da
view de conveniência declarado.

---

## I — Information Disclosure (Vazamento de informação)

### I1. Vazamento de saldo via análise de transações

**Cenário:** observador da rede correlaciona padrões de transação para inferir saldos.

**Impacto:** alto se viável.

**Mitigação:**
- Saldos nunca aparecem em plaintext (validado em `DvPSettlement.spec.ts` "RNF06")
- Commitments Poseidon são hiding com randomness ≥128 bits (CSPRNG)
- Eventos `CommitmentMinted`/`Updated`/`Shredded` carregam apenas hashes

**Risco residual:** **timing analysis** — se DvPs ocorrem em padrões previsíveis (e.g., toda 6ª feira às 17h), atacante pode correlacionar com eventos externos.

---

### I2. Ataque de fluxo de rede (Ismayilov & Özturan, 2023)

**Cenário:** atacante observa metadados de rede (tamanho de pacotes, timing entre requests) para correlacionar transações com pagadores específicos.

**Referência:** Ismayilov, A. & Özturan, C. (2023) documentaram este ataque contra o protocolo PTTS (Privacy-Preserving Token Transfer System), análogo à nossa arquitetura. Mostraram que mesmo com ZKP perfeito, padrões de timing/tamanho permitem inferir partes envolvidas.

**Impacto:** médio — não revela valores, mas pode quebrar **anonimato de partes** em rede semi-pública.

**Medição empírica (script `scripts/timing_analysis.ts`):** 15 DvPs sequenciais foram submetidos e os canais observáveis medidos. Resultado (artefatos em `benchmark/results/timing_analysis.{csv,json}`):

| Canal | Range observado | Interpretação |
|---|---|---|
| `calldata` (bytes) | **0** | Constante — ECIES com payload de tamanho fixo não vaza por calldata |
| `ciphertext` (bytes) | **0** | Constante |
| `gasUsed` steady-state (excluindo 1ª tx) | **24 gas** | Negligível — abaixo do ruído de SSTORE warm (~100 gas) |
| `gasUsed` 1ª tx vs subsequentes | **17.064 gas** | **Efeito de cold storage write** (SSTORE cold ≈ 22.100 gas), intrínseco à EVM e não específico ao protocolo |
| `delta entre blocos` | **0 s** | Hardhat automine constante; em Besu seria ~2s do consenso QBFT |

**Achado defensável:** após a primeira transação (cold start), a PoC **não vaza sinal observável** por gas, calldata ou ciphertext. Em outras palavras: o ataque de Ismayilov & Özturan (2023) — que pressupõe variação em tamanho de pacote/calldata correlacionada com partes — **não se aplica** a esta implementação para essa dimensão.

**Risco residual NÃO mitigado:** **timing macro** (DvPs em horários previsíveis correlacionáveis a eventos externos como folha de pagamento, leilões, etc.). Mitigação proposta como trabalho futuro:

- **Batching temporal:** acumular DvPs em janelas fixas e processá-los em ordem aleatória
- **Mixing de timing:** introduzir delay aleatório entre `submit` do cliente e `mine` do validador

**Status:** **Mitigado parcialmente com medição empírica** (canais de tamanho/gas). Timing macro permanece como trabalho futuro com escopo claro.

---

### I3. Vazamento de saldo via brute-force se randomness é fraca

**Cenário:** se randomness `r` tem entropia insuficiente (e.g., contador), atacante pode brute-force valores possíveis e abrir o commitment.

**Impacto:** crítico.

**Mitigação:**
- Cliente off-chain DEVE usar CSPRNG (`crypto.randomBytes(16)` mínimo, recomendado 32 bytes)
- Documentado em `docs/REPRODUCIBILITY.md` e `ADR-0004`

**Status:** **Mitigado por convenção**; depende do cliente seguir a especificação.

---

### I4. Vazamento via REGULATOR_ROLE comprometido

**Cenário:** chave privada do regulador é roubada.

**Impacto:** crítico — atacante decifra todo o histórico de transações cifradas para o regulador.

**Mitigação:**
- HSM (Hardware Security Module) para armazenamento da chave em produção
- Rotação periódica da chave (com necessidade de re-cifrar histórico ou aceitar perda)
- Multi-party key generation (Shamir Secret Sharing 3 de 5)
- Monitoramento de uso anômalo
- **Limita o impacto via `RegulatorMultiSig`**: mesmo que a chave de UM membro seja comprometida, atacante precisa comprometer M chaves independentes (threshold do multisig). Reduz o "raio de explosão" do vazamento de uma única chave

**Status:** **Mitigação parcial** na PoC (chave em texto plano em ambiente de teste); demonstrador `RegulatorMultiSig` reduz drasticamente o impacto de comprometimento de uma única chave; HSM e rotação como fortalecimento crítico para produção.

---

## D — Denial of Service

### D1. Spam de transações DvP custosas

**Cenário:** atacante submete milhares de `executeDvP` por bloco para esgotar gas e atrasar transações legítimas.

**Impacto:** médio — degrada UX da rede.

**Mitigação:**
- **Rate limit** implementado em `DvPSettlement`: 1 DvP por endereço por bloco (validado em `DvPSettlement.spec.ts` "rate limiting")
- Custo de gas elevado por transação (~503k) já desincentiva spam
- Validadores QBFT podem priorizar transações via mempool em produção

**Status:** **Mitigado**.

---

### D2. Ataque de prova invalida que consome gas

**Cenário:** atacante submete provas inválidas em massa, fazendo o Verifier consumir gas para rejeitá-las.

**Impacto:** médio — atacante paga o gas mas a rede fica congestionada.

**Mitigação:**
- Custo de verificação ~264k gas torna o ataque caro para o atacante
- Em produção, considerar:
  - **Stake** prévio do submitter (e.g., depositar ETH como caução)
  - **Whitelisting** de pagadores autorizados via `MINTER_ROLE`-like

**Status:** **Mitigado parcialmente pelo custo**; escalonamento documentado.

---

### D3. Esgotamento da CRS (one-shot trusted setup)

**Cenário:** se a CRS for invalidada (e.g., descobrimento de toxic waste), todas as provas existentes precisam ser regeneradas.

**Impacto:** alto — interrupção do serviço.

**Mitigação:**
- Cerimônia MPC para produção (ADR-0003)
- Plano de resposta: regenerar CRS, redeployar Verifier, re-mintar commitments (ou migração direta)

**Status:** **Risco aceito** na PoC (setup local); plano para produção.

---

## E — Elevation of Privilege (Escalada de privilégios)

### E1. Comprometimento da CRS (Common Reference String)

**Cenário:** alguém que participou do trusted setup retém a "toxic waste" (randomness usada na geração da CRS) e a usa para forjar provas válidas.

**Impacto:** **catastrófico** — atacante pode mintar valor arbitrário sem solvência.

**Mitigação:**
- **PoC:** trusted setup local é executado em container Docker descartável; randomness em memória é destruída ao final. **Risco aceito** com aviso explícito (ADR-0003).
- **Produção:** cerimônia MPC Powers-of-Tau com ≥100 participantes (modelo Zcash); 1-of-N security
- Hash da CRS é verificável publicamente; transcripts publicados para auditoria

**Status:** **Risco crítico**, **mitigado por arquitetura** em produção; **declarado como limitação** na PoC.

---

### E2. Bypass do AccessControl via reentrância

**Cenário:** atacante chama `executeDvP` que chama `setCommitment` que chama de volta `executeDvP` (reentrância) para pular o rate limit.

**Impacto:** alto.

**Mitigação:**
- `DvPSettlement` herda `ReentrancyGuard` da OZ; `executeDvP` é `nonReentrant`
- `PrivateToken.setCommitment` é simples (sem callbacks externos), mas a defesa em profundidade do `nonReentrant` cobre o caso

**Status:** **Mitigado**.

---

### E3. Vulnerabilidade no Verifier.sol gerado

**Cenário:** bug no código Solidity gerado pelo ZoKrates `export-verifier` permite verificação errônea.

**Impacto:** crítico.

**Mitigação:**
- ZoKrates é open source com auditorias contínuas
- Verifier.sol é o **mesmo template** usado em projetos auditados (Tornado Cash, Semaphore, Polygon ID)
- Testes de integração incluem cenário "InvalidProof" que valida rejeição

**Status:** **Mitigado** pela maturidade da ferramenta + testes.

---

## Resumo executivo

| Categoria | Ameaças identificadas | Mitigadas | Risco residual |
|---|---|---|---|
| **Spoofing** | 3 | 3 | Baixo |
| **Tampering** | 3 | 3 | Baixo (auditoria de circuito recomendada) |
| **Repudiation** | 2 | 2 | Baixo (R2 fechado via `accessEncryptedTx`) |
| **Information Disclosure** | 4 | 3 | Baixo a Médio (I2 medido: 0 sinal em calldata/gas steady-state; resíduo = timing macro) |
| **Denial of Service** | 3 | 3 | Baixo |
| **Elevation of Privilege** | 3 | 3 | **Crítico para produção** (E1: CRS) |

**Conclusão:** a PoC mitiga adequadamente as ameaças relevantes para o **escopo acadêmico** (TCC). Para uma transição a produção do DREX, três áreas exigem fortalecimento:

1. **Cerimônia MPC** para o trusted setup (E1) — pré-requisito absoluto
2. **Auditoria de circuito** por terceiro independente (T2)
3. **Mitigações contra timing macro** (I2 residual) — apenas o canal de timing inter-DvPs permanece como vetor; calldata/gas já medidos e validados como não-vazantes

---

## Referências

- Microsoft (2007). *The STRIDE Threat Model*. Microsoft Developer Network.
- Ismayilov, A. & Özturan, C. (2023). *Privacy Attacks on ZKP-Based Token Transfer Protocols*.
- Burgos, D. & Alchieri, E. (2025). *Privacy-Preserving DvP in Permissioned Blockchains*. arXiv:2501.03391.
- Bowe, S. et al. (2017). *Scalable Multi-Party Computation for zk-SNARK Parameters*. IACR ePrint 2017/1050.
- OpenZeppelin Contracts. *AccessControl.sol*, *ReentrancyGuard.sol*. v5.0.
- IMF Fintech Note 2024/004. *Privacy in CBDC Systems: Technical and Legal Patterns*.
