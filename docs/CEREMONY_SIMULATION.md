# Cerimônia MPC simulada — demonstrador de orquestração 2-party

> **Status**: demonstrador acadêmico. NÃO substitui uma cerimônia real de produção.
> **Script**: `scripts/simulated_mpc_ceremony.sh`
> **Comando**: `make zkp:ceremony`
> **ADR relacionada**: [ADR-0003](ADR/0003-trusted-setup-handling.md)

---

## 1. Motivação

O ADR-0003 declara, com transparência, que o setup Groth16 padrão da PoC
é **local de nó único** — toda a "toxic waste" passa por um único processo
(o container ZoKrates rodando na máquina do desenvolvedor). Adequado para
PoC; insuficiente para produção, que exige cerimônia **MPC (Multi-Party
Computation)** com múltiplos contribuintes independentes.

A crítica recorrente — inclusive de orientador — é: *"você diz que a
arquitetura suporta MPC, mas não mostra"*. Este documento e o script
`simulated_mpc_ceremony.sh` respondem a essa crítica de duas formas:

1. **Empiricamente** — executando dois setups Groth16 independentes (Alice
   e Bob) e mostrando que a CRS resultante depende da entropy de cada
   participante (hashes SHA-256 distintos das `verification.key`).
2. **Documentalmente** — listando textualmente, no transcript da
   cerimônia simulada, os comandos exatos de uma cerimônia MPC real
   (`zokrates mpc init/contribute/beacon/verify/export`) que esta PoC
   suporta na arquitetura mas não executa por escopo.

## 2. O que o script faz

1. **Recompila não — circuito imutável**: o `out` produzido por
   `make zkp:setup` (R1CS de 1.728 constraints) é reutilizado.
2. **Setup de Alice**: `zokrates setup` com entropy A → `alice_verification.key`.
3. **Setup de Bob**: `zokrates setup` com entropy B → `bob_verification.key`.
4. **Comparação SHA-256**: imprime os hashes de `vk_local`, `vk_Alice`,
   `vk_Bob` e confirma que são **distintos** — i.e., o backend Groth16
   efetivamente consome a randomness e a CRS resultante varia.
5. **Documentação inline**: o transcript lista os comandos da cerimônia
   MPC real e referencia esta documentação.

## 3. O que o script NÃO faz (e por quê)

Uma cerimônia MPC real do Groth16 (Bowe-Gabizon-Miers 2017) requer:

- Um arquivo **Phase 1 (Powers of Tau)** em formato `phase1radix2m{N}` —
  formato proprietário do backend Bellman, **distinto** do formato `.ptau`
  do snarkjs. Para `solvency_dvp.zok` (≈1.728 constraints) seria o
  `phase1radix2m11` (~40 MB).
- Os comandos `zokrates mpc init/contribute/beacon/verify/export`, que
  combinam **criptograficamente** (não apenas posicionalmente) as
  contribuições dos participantes.

Esta PoC **não embute** o arquivo Phase 1 por dois motivos:

- **Reprodutibilidade**: arquivos Phase 1 estão hospedados em locais
  voláteis (S3 buckets de cerimônias que podem sair do ar) e seu download
  programático é instável em redes corporativas/bibliotecas universitárias.
  Forçar `make all` a depender desse download fragilizaria a
  reprodutibilidade local.
- **Tamanho**: 40 MB versionados ou baixados a cada `make` quebram o
  princípio de "demonstrador roda em segundos".

Por isso, o script entrega um **demonstrador de orquestração** — prova que
a separação entre circuito/contratos e CRS existe e funciona, sem
pretender executar criptografia MPC real.

## 4. Como executar a cerimônia MPC real

Caso queira validar a cerimônia criptográfica completa:

```bash
# 1) Obter o arquivo Phase 1 (formato bellman, NÃO .ptau do snarkjs).
#    Fontes históricas:
#    - Tornado Cash MPC archives
#    - Semaphore protocol releases
#    - Compilar e executar manualmente o tool em
#      https://github.com/ebfull/powersoftau

#    Coloque em circuits/ptau/phase1radix2m11

# 2) Recompilar o circuito com backend bellman (mpc só funciona em bellman):
docker run --rm -v "$PWD:/c" -w /c zokrates/zokrates:0.8.8 \
  zokrates compile -i circuits/solvency_dvp.zok \
    -o circuits/proving_key/out

# 3) Cerimônia (2 contribuintes + beacon):
docker run --rm -v "$PWD:/c" -w /c zokrates/zokrates:0.8.8 bash -c "
  zokrates mpc init      -i circuits/proving_key/out \
    -r circuits/ptau/phase1radix2m11 \
    -o circuits/ceremony/phase2_0.params

  zokrates mpc contribute -i circuits/ceremony/phase2_0.params \
    -o circuits/ceremony/phase2_alice.params -e 'alice-entropy'

  zokrates mpc contribute -i circuits/ceremony/phase2_alice.params \
    -o circuits/ceremony/phase2_bob.params   -e 'bob-entropy'

  zokrates mpc beacon -i circuits/ceremony/phase2_bob.params \
    -o circuits/ceremony/phase2_final.params \
    -h 0000000000000000000000000000000000000000000000000000000000abcdef -n 10

  zokrates mpc verify -i circuits/ceremony/phase2_final.params \
    -c circuits/proving_key/out \
    -r circuits/ptau/phase1radix2m11

  zokrates mpc export -i circuits/ceremony/phase2_final.params \
    -p circuits/ceremony/proving.key \
    -v circuits/ceremony/verification.key

  zokrates export-verifier \
    -i circuits/ceremony/verification.key \
    -o contracts/Verifier.sol
"

# 4) Re-deployar (Verifier.sol mudou):
make deploy
```

## 5. Modelo de segurança 1-of-N

A propriedade fundamental do MPC do Groth16 (Bowe, Gabizon, Miers 2017)
é: **basta que UM dos contribuintes descarte sua randomness para que a
CRS resultante seja segura** — independentemente do que os outros
contribuintes fizeram. O random beacon final é uma proteção adicional
contra o caso patológico em que TODOS os contribuintes humanos conspirem:
a randomness do beacon (e.g., hash de um bloco Bitcoin futuro) é imune.

## 6. O que falta para virar cerimônia de produção

| Aspecto | Aqui (demonstrador) | Produção real |
|---|---|---|
| Combinação criptográfica das contribuições | Não — setups paralelos | Sim, via `mpc contribute` |
| Contribuintes em hosts distintos | Não — mesmo container | Sim, com attestação remota |
| Diversidade jurisdicional | Não | Mínimo 3 jurisdições distintas |
| Coordenador independente | Não há | LIFT Lab / BCB / consórcio neutro |
| Transcripts publicados | Apenas local | GitHub release + IPFS + commit on-chain |
| Random beacon real | Hash literal `0x…abcdef` | Hash de bloco Bitcoin futuro |
| Duração | < 30 segundos | 1–4 semanas |
| Número mínimo de participantes | 2 simulados | ≥ 5 (Zcash Sapling: 87; Tornado Cash: ~1.000) |

## 7. Referências

- Bowe, S., Gabizon, A., Miers, I. (2017). *Scalable Multi-Party
  Computation for zk-SNARK Parameters in the Random Beacon Model*.
  IACR ePrint 2017/1050.
- Perpetual Powers of Tau ceremony.
  https://github.com/privacy-scaling-explorations/perpetualpowersoftau
- Bowe, S. *powersoftau*. https://github.com/ebfull/powersoftau
- Zcash Foundation (2018). *Sapling MPC ceremony report*.
- ZoKrates 0.8 Documentation — *MPC ceremony*.
  https://zokrates.github.io/toolbox/trusted_setup.html#mpc-ceremonies
