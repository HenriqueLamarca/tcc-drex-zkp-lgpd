# ADR-0003: Tratamento do trusted setup do Groth16

- **Status:** Aceito
- **Data:** 2026-05-12
- **Marco:** M3 — Circuito ZoKrates + Verifier exportado
- **Decisores:** Henrique Lamarca; orientação acadêmica de Tassio Ferenzini Martins Sirqueira

---

## Contexto

O esquema zk-SNARK **Groth16** (Jens Groth, 2016) é o backend padrão do ZoKrates 0.8 e oferece o melhor custo-benefício na verificação on-chain — provas constantes (~256 bytes) e gas previsível (~250.000 wei) graças aos precompileds BN128 da EVM.

A propriedade de **succinctness** vem com um custo: Groth16 requer uma **Common Reference String (CRS)** específica por circuito, gerada em uma cerimônia chamada **trusted setup**. Durante essa cerimônia, secret randomness (frequentemente chamada de "toxic waste") é amostrada. Se a randomness for **comprometida ou retida**, o detentor pode forjar provas inválidas que passam na verificação — quebra completa da segurança.

A PoC precisa de uma CRS para:
- A proving key consumida pelo gerador de provas off-chain
- A verification key embutida em `Verifier.sol` que o `DvPSettlement` chama on-chain

---

## Decisão

**A PoC utiliza um trusted setup local de nó único, executado por `scripts/01_setup_zkp.sh` na máquina do desenvolvedor.** A randomness é mantida em memória do container ZoKrates e descartada ao final da execução, mas **não é verificável externamente**.

A escolha é declarada explicitamente como **inadequada para produção** e documentada em:

- Mensagem de aviso emitida pelo próprio `01_setup_zkp.sh`
- Seção dedicada no `README.md` e `docs/REPRODUCIBILITY.md`
- Limitação reconhecida na matriz LGPD (`LGPD_COMPLIANCE.md`)

---

## Justificativa

### 1. Escopo de PoC acadêmica

O objetivo do TCC é **demonstrar a viabilidade técnica e regulatória** de privacidade por design no DREX. Reproduzir uma cerimônia MPC (Multi-Party Computation) realista exigiria:

- ≥ 3 participantes geograficamente distribuídos
- Coordenação temporal e ferramental especializado (Powers of Tau)
- ≥ 1 semana de cerimônia + verificação pública
- Infraestrutura de attestação não disponível em ambiente acadêmico

Para o objetivo de **provar o conceito**, o setup local é suficiente: o predicado é executado corretamente, as provas são geradas e verificadas, e a propriedade de zero-knowledge é preservada — assumindo que o operador da PoC não retém a randomness.

### 2. Independência da decisão arquitetural

O tipo de setup é **ortogonal** ao desenho do circuito e dos contratos. Quando a PoC for migrada para produção, a única mudança é substituir as chaves geradas localmente pelas chaves de uma cerimônia MPC — todo o restante do código (circuito, contratos, scripts) permanece idêntico. Isso é validável por inspeção do `Verifier.sol`: a verification key aparece como constantes hardcoded, isoláveis.

### 3. Reprodutibilidade local declarada

`make zkp:setup` regenera deterministicamente os artefatos a cada execução, garantindo que qualquer pessoa que clone o repositório possa reproduzir o pipeline. As chaves resultantes serão diferentes a cada setup — o que é correto para uma PoC: nenhuma chave deve ser tratada como "oficial".

---

## Caminhos para produção

A migração para um ambiente de produção do DREX requereria uma cerimônia MPC pública seguindo o padrão **Powers of Tau** + **Phase 2 per-circuit ceremony**, como utilizado por:

- **Zcash** (Sapling e Sprout ceremonies, 2016 e 2018)
- **Tornado Cash** (Phase 2 ceremony, 2019, ~1.000 participantes)
- **Semaphore / Polygon ID** (cerimônias modulares para circuitos PLONK e Groth16)

Etapas mínimas:

1. **Phase 1 — Powers of Tau (universal, circuit-agnostic)**
   - Coordenação por entidade neutra (LIFT Lab, Banco Central, ou consórcio multi-institucional)
   - Mínimo 100 participantes distribuídos para garantir 1-of-N security
   - Cada participante contribui randomness e prova a contribuição via transcript público

2. **Phase 2 — Specialização por circuito**
   - Aplicada por circuito específico (`solvency_dvp.zok`, e qualquer outro circuito futuro)
   - Mesma propriedade 1-of-N

3. **Publicação**
   - Hash da CRS final em registro público (GitHub release + IPFS + on-chain commit)
   - Transcripts de todas as contribuições disponíveis para auditoria
   - Verifier.sol exportado a partir das chaves resultantes

4. **Governança**
   - Documentação dos critérios de seleção de participantes (idoneidade, diversidade jurisdicional, expertise técnica)
   - Procedimento publicado de revogação caso comprometimento seja detectado

### Alternativa: migrar para esquema universal

PLONK e Halo2 usam setup **universal e atualizável** — uma única cerimônia serve para circuitos arbitrários e pode ser estendida indefinidamente sem cerimônia nova por circuito. Avaliado em **ADR-0001** (Groth16 vs PLONK vs STARK) e descartado por overhead de gas significativamente maior na PoC (~5x). Para produção, esta troca pode ser reavaliada.

---

## Consequências

### Positivas

- Setup roda em < 10s na máquina de referência (RNF04 atendido)
- Pipeline completamente reprodutível (`make zkp:setup`)
- Decisão honestamente declarada — banca examinadora pode avaliar a PoC sem ambiguidade sobre limitações

### Negativas

- A PoC **não pode** ser usada como base de produção sem refazer a CRS via cerimônia MPC
- Qualquer mudança no circuito `solvency_dvp.zok` invalida a CRS atual — em produção, exigiria nova cerimônia (motivação adicional para considerar PLONK em ADR futuro)
- Confiança no operador da PoC: usuários precisam acreditar que a randomness foi descartada

### Riscos mitigados

- **Risco:** alguém usar a CRS local em produção pensando que é segura.
  **Mitigação:** banner de aviso no `01_setup_zkp.sh` e seção dedicada no `README.md`.

- **Risco:** dados da CRS local vazarem e atacantes forjarem provas.
  **Mitigação:** rede Besu é privada/permissionada com 4 validadores conhecidos; mesmo que provas falsas fossem geradas, atacante precisaria também comprometer um validador para incluí-las (modelo de ameaças completo em `THREAT_MODEL.md`).

---

## Referências

- Groth, J. (2016). *On the Size of Pairing-Based Non-interactive Arguments*. EUROCRYPT 2016.
- Bowe, S., Gabizon, A., Miers, I. (2017). *Scalable Multi-Party Computation for zk-SNARK Parameters in the Random Beacon Model*. IACR ePrint 2017/1050.
- Powers of Tau ceremony documentation. https://github.com/privacy-scaling-explorations/perpetualpowersoftau
- Zcash Foundation. *Sapling MPC ceremony report* (2018).
- Eberhardt, J. & Tai, S. (2018). *On or Off the Blockchain? Insights on Off-Chaining Computation and Data*.
- ZoKrates Documentation. *Trusted setup*. https://zokrates.github.io/toolbox/trusted_setup.html
