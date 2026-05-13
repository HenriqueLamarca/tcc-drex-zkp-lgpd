// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title PrivateToken — Token privado armazenado como Poseidon hash commitments.
 * @notice Implementacao deliberadamente NAO conforme ERC-20 (ADR-0001/ADR-0004).
 *         Saldos sao representados apenas pelo commitment(value, randomness)
 *         on-chain. Nenhum valor em plaintext circula via storage, eventos
 *         ou calldata neste contrato.
 *
 * LGPD (referencias diretas):
 *  - Art. 5º, XI (anonimizacao): commitment so' e' aberto por quem detem (v, r)
 *  - Art. 6º, III (necessidade): so' o minimo necessario e' exposto
 *  - Art. 6º, VII (seguranca): Poseidon como primitiva de hash resistente
 *  - Art. 18, VI (eliminacao): operacao cryptoShred zera o commitment
 *
 * Modelo de papeis (AccessControl):
 *  - DEFAULT_ADMIN_ROLE: governanca, pode conceder/revogar outros papeis
 *  - MINTER_ROLE: emissor do token (BCB-equivalente no DREX) — registra
 *    commitments iniciais
 *  - SETTLEMENT_ROLE: contrato DvPSettlement — atualiza commitments apos
 *    verificacao de prova Groth16
 *  - REGULATOR_ROLE: regulador (LC 105/2001) — pode executar crypto-shred
 *
 * @dev Total supply nao e' rastreado on-chain — limitacao reconhecida da
 *      PoC. Producao exigiria commitment somatorio + range proofs para
 *      auditoria contabil. Ver REPRODUCIBILITY.md.
 */
contract PrivateToken is AccessControl {
    // ─── Papeis ─────────────────────────────────────────────────────────────

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    // ─── Storage ────────────────────────────────────────────────────────────

    /// @notice Mapeia endereco -> commitment Poseidon(saldo, randomness).
    /// @dev bytes32(0) representa "sem saldo registrado" ou "shredded".
    mapping(address account => bytes32 commitment) public commitments;

    /// @notice Nome amigavel do token, exposto via leitura publica.
    string public constant NAME = "DREX Privado (PoC)";

    /// @notice Simbolo curto.
    string public constant SYMBOL = "pDREX";

    // ─── Eventos ────────────────────────────────────────────────────────────

    /// @notice Emitido na criacao do commitment inicial de um titular.
    /// @dev Nao revela valor; auditoria off-chain via RegulatorViewer.
    event CommitmentMinted(address indexed account, bytes32 commitment);

    /// @notice Emitido em atualizacao de commitment pelo DvPSettlement.
    event CommitmentUpdated(
        address indexed account,
        bytes32 oldCommitment,
        bytes32 newCommitment
    );

    /// @notice Emitido quando regulador executa crypto-shred (LGPD art. 18, VI).
    /// @dev O evento e' permanente no historico do bloco (imutabilidade), mas
    ///      o estado atual perde toda referencia ao titular.
    event CommitmentShredded(address indexed account, bytes32 lastCommitment);

    // ─── Erros customizados (gas-eficientes) ────────────────────────────────

    error CommitmentAlreadyExists(address account);
    error CommitmentNotFound(address account);
    error InvalidCommitment();

    // ─── Construtor ─────────────────────────────────────────────────────────

    /**
     * @param admin Endereco com DEFAULT_ADMIN_ROLE (governanca do sistema).
     */
    constructor(address admin) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ─── Operacoes de mint (emissao inicial) ────────────────────────────────

    /**
     * @notice Registra commitment inicial de um titular. Executado pelo emissor.
     * @dev Idempotencia rejeitada: para evitar reset acidental de saldo, exige
     *      que o commitment atual seja zero. Atualizacoes subsequentes passam
     *      pelo DvPSettlement (com prova Groth16).
     * @param account Endereco do titular.
     * @param commitment Hash Poseidon do saldo inicial + randomness.
     */
    function mint(address account, bytes32 commitment) external onlyRole(MINTER_ROLE) {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        if (commitments[account] != bytes32(0)) revert CommitmentAlreadyExists(account);

        commitments[account] = commitment;
        emit CommitmentMinted(account, commitment);
    }

    // ─── Operacoes de transferencia (chamadas pelo DvPSettlement) ───────────

    /**
     * @notice Atualiza o commitment de um titular apos transferencia validada
     *         por prova Groth16. So' o contrato DvPSettlement pode invocar.
     * @dev O DvPSettlement e' responsavel por verificar a prova antes de chamar.
     *      Aqui aceitamos o commitment como confiavel (assumindo papel correto).
     * @param account Endereco do titular.
     * @param newCommitment Novo commitment validado pela prova.
     */
    function setCommitment(
        address account,
        bytes32 newCommitment
    ) external onlyRole(SETTLEMENT_ROLE) {
        if (newCommitment == bytes32(0)) revert InvalidCommitment();
        bytes32 old = commitments[account];
        if (old == bytes32(0)) revert CommitmentNotFound(account);

        commitments[account] = newCommitment;
        emit CommitmentUpdated(account, old, newCommitment);
    }

    // ─── Crypto-shredding (RF06 — LGPD art. 18, VI) ─────────────────────────

    /**
     * @notice Zera o commitment de um titular. Operacao irreversivel no estado
     *         atual; o evento permanece no historico (imutabilidade da chain).
     * @dev Limitacao reconhecida em ADR-0005 e LGPD_COMPLIANCE.md: o evento
     *      CommitmentShredded persiste no historico do bloco, mas o estado
     *      atual perde toda referencia ao titular. Para producao, considerar
     *      tambem rotacao da viewing key do regulador.
     * @param account Endereco do titular cujo commitment sera apagado.
     */
    function cryptoShred(address account) external onlyRole(REGULATOR_ROLE) {
        bytes32 last = commitments[account];
        if (last == bytes32(0)) revert CommitmentNotFound(account);

        commitments[account] = bytes32(0);
        emit CommitmentShredded(account, last);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    /**
     * @notice Indica se um titular possui commitment registrado e nao-shredded.
     */
    function hasCommitment(address account) external view returns (bool) {
        return commitments[account] != bytes32(0);
    }
}
