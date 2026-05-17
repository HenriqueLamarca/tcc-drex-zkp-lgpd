// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Verifier} from "./Verifier.sol";
import {PrivateToken} from "./PrivateToken.sol";
import {RegulatorViewer} from "./RegulatorViewer.sol";

/**
 * @title DvPSettlement — Orquestrador atomico de Delivery-vs-Payment.
 * @notice Verifica prova Groth16 do circuito solvency_dvp.zok e, se valida,
 *         atualiza commitments de A e B no PrivateToken e registra trilha
 *         cifrada no RegulatorViewer — tudo em uma unica transacao atomica.
 *
 * Garantias (RF03):
 *  - Atomicidade: ou a transacao DvP inteira sucede, ou nada muda
 *  - Verificacao on-chain via precompileds BN128 (custo previsivel ~250k gas)
 *  - Estado consistente entre PrivateToken (commitments) e RegulatorViewer
 *    (audit trail) ao final do bloco
 *
 * Rate limiting (anti-DoS — THREAT_MODEL.md):
 *  - Cada endereco pode executar no maximo 1 DvP por bloco como pagador
 *  - Impede burst de provas custosas em um unico bloco
 *
 * LGPD:
 *  - Art. 6º, III (necessidade): so' valores estritamente necessarios
 *    aparecem em calldata — proof + 4 commitments publicos + ciphertext
 *  - Art. 6º, VII (seguranca): atomicidade impede estados intermediarios
 *  - Art. 5º, XI (anonimizacao): nenhum valor de saldo aparece em log/event
 */
contract DvPSettlement is AccessControl, ReentrancyGuard {
    // ─── Componentes referenciados ──────────────────────────────────────────

    Verifier public immutable verifier;
    PrivateToken public immutable token;
    RegulatorViewer public immutable regulatorViewer;

    // ─── Rate limiting ──────────────────────────────────────────────────────

    /// @notice Ultimo bloco em que cada endereco executou DvP como pagador.
    mapping(address payer => uint256 blockNumber) public lastDvPBlock;

    // ─── Eventos ────────────────────────────────────────────────────────────

    /**
     * @notice Emitido quando DvP e' liquidado com sucesso.
     * @dev Os commitments antigo/novo aparecem nos parametros mas nao revelam
     *      valores (sao hashes Poseidon).
     */
    event DvPSettled(
        uint256 indexed txId,
        address indexed from,
        address indexed to,
        bytes32 fromOldCommitment,
        bytes32 toOldCommitment,
        bytes32 fromNewCommitment,
        bytes32 toNewCommitment
    );

    // ─── Erros ──────────────────────────────────────────────────────────────

    error InvalidProof();
    error CommitmentMismatch(address party, bytes32 expected, bytes32 actual);
    error RateLimitExceeded(address payer, uint256 lastBlock);
    error InvalidParties();
    error EmptyCiphertext();

    // ─── Construtor ─────────────────────────────────────────────────────────

    constructor(
        address admin,
        Verifier verifier_,
        PrivateToken token_,
        RegulatorViewer regulatorViewer_
    ) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        verifier = verifier_;
        token = token_;
        regulatorViewer = regulatorViewer_;
    }

    // ─── Estrutura de entrada ───────────────────────────────────────────────

    /**
     * @dev Input "public" do circuito Groth16, na ordem definida em
     *      circuits/solvency_dvp.zok:
     *        [0] commit_A_old (pagador, antes)
     *        [1] commit_B_old (recebedor, antes)
     *        [2] commit_A_new (pagador, depois)
     *        [3] commit_B_new (recebedor, depois)
     */
    struct DvPInputs {
        uint256 commitAOld;
        uint256 commitBOld;
        uint256 commitANew;
        uint256 commitBNew;
    }

    // ─── Operacao principal ─────────────────────────────────────────────────

    /**
     * @notice Liquida uma transferencia DvP entre `from` e `to`, validada por
     *         prova Groth16 sobre o circuito solvency_dvp.
     * @dev Sequencia:
     *      1. Rate-limit check (anti-DoS)
     *      2. Comparacao dos commitments antigos com estado on-chain
     *      3. Verificacao da prova via Verifier.verifyTx (precompiled BN128)
     *      4. Atualizacao dos commitments via PrivateToken.setCommitment
     *      5. Registro do blob cifrado no RegulatorViewer
     * @param from Endereco do pagador. Deve coincidir com o owner do
     *             commitAOld em PrivateToken.
     * @param to Endereco do recebedor. Deve coincidir com o owner do
     *             commitBOld em PrivateToken.
     * @param proof Prova Groth16 serializada (a, b, c).
     * @param inputs Quatro commitments publicos do circuito.
     * @param encryptedBlob ECIES(regulator_pk, {from, to, value, ...})
     *                       — cifrado off-chain pelo cliente do pagador.
     */
    function executeDvP(
        address from,
        address to,
        Verifier.Proof calldata proof,
        DvPInputs calldata inputs,
        bytes calldata encryptedBlob
    ) external nonReentrant returns (uint256 txId) {
        // 1. Validacoes basicas de partes
        if (from == address(0) || to == address(0) || from == to) {
            revert InvalidParties();
        }
        if (encryptedBlob.length == 0) revert EmptyCiphertext();

        // 2. Rate limit — 1 DvP por bloco como pagador
        uint256 lastBlock = lastDvPBlock[from];
        if (lastBlock == block.number) {
            revert RateLimitExceeded(from, lastBlock);
        }
        lastDvPBlock[from] = block.number;

        // 3. Verifica que os commitments antigos batem com o estado on-chain
        bytes32 fromOldOnChain = token.commitments(from);
        bytes32 toOldOnChain = token.commitments(to);
        bytes32 fromOldClaimed = bytes32(inputs.commitAOld);
        bytes32 toOldClaimed = bytes32(inputs.commitBOld);

        if (fromOldOnChain != fromOldClaimed) {
            revert CommitmentMismatch(from, fromOldOnChain, fromOldClaimed);
        }
        if (toOldOnChain != toOldClaimed) {
            revert CommitmentMismatch(to, toOldOnChain, toOldClaimed);
        }

        // 4. Verifica a prova Groth16 (precompiled BN128)
        uint256[4] memory inputArr = [
            inputs.commitAOld,
            inputs.commitBOld,
            inputs.commitANew,
            inputs.commitBNew
        ];
        bool valid = verifier.verifyTx(proof, inputArr);
        if (!valid) revert InvalidProof();

        // 5. Atualiza commitments atomicamente
        bytes32 fromNew = bytes32(inputs.commitANew);
        bytes32 toNew = bytes32(inputs.commitBNew);
        token.setCommitment(from, fromNew);
        token.setCommitment(to, toNew);

        // 6. Registra trilha cifrada no RegulatorViewer
        txId = regulatorViewer.recordTx(from, to, encryptedBlob);

        emit DvPSettled(
            txId,
            from,
            to,
            fromOldClaimed,
            toOldClaimed,
            fromNew,
            toNew
        );
    }

}
