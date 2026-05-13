// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/**
 * @title RegulatorViewer — Trilha de auditoria cifrada para o regulador.
 * @notice Cada transacao DvP registra aqui um blob ECIES cifrado para a chave
 *         publica do regulador. O regulador (papel REGULATOR_ROLE, espelhando
 *         LC 105/2001 — sigilo bancario) recupera o blob e decifra off-chain.
 *
 * Modelo de privacidade (RF05):
 *  - Blob e' opaco para todos os outros papeis e para a rede em geral
 *  - Conteudo tipico (decidido off-chain): {from, to, value, timestamp, txHash}
 *  - O contrato NAO faz crypto — apenas armazena bytes
 *
 * Limitacao reconhecida em ADR-0001 e THREAT_MODEL.md:
 *  - "Seletividade" do regulador e' processual, nao criptografica — quem detem
 *    a chave privada decifra TUDO que estiver cifrado para ele. Para producao
 *    com seletividade verdadeira, considerar selective disclosure ZKP
 *    (Burgos & Alchieri 2025).
 */
contract RegulatorViewer is AccessControl {
    // ─── Papeis ─────────────────────────────────────────────────────────────

    bytes32 public constant SETTLEMENT_ROLE = keccak256("SETTLEMENT_ROLE");
    bytes32 public constant REGULATOR_ROLE = keccak256("REGULATOR_ROLE");

    // ─── Storage ────────────────────────────────────────────────────────────

    struct EncryptedRecord {
        address from;
        address to;
        uint256 blockNumber;
        uint256 timestamp;
        bytes ciphertext; // ECIES(secp256k1, regulatorPubKey, payload)
    }

    /// @notice Sequencial de transacoes registradas.
    uint256 public txCount;

    /// @notice Registros indexados por txId.
    mapping(uint256 txId => EncryptedRecord record) private _records;

    // ─── Eventos ────────────────────────────────────────────────────────────

    /// @notice Emitido quando o DvPSettlement registra uma nova transacao
    ///         cifrada para o regulador.
    event TxRecorded(
        uint256 indexed txId,
        address indexed from,
        address indexed to
    );

    // ─── Erros ──────────────────────────────────────────────────────────────

    error EmptyCiphertext();
    error TxNotFound(uint256 txId);

    // ─── Construtor ─────────────────────────────────────────────────────────

    constructor(address admin, address regulator) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (regulator != address(0)) {
            _grantRole(REGULATOR_ROLE, regulator);
        }
    }

    // ─── Registro (chamado pelo DvPSettlement) ──────────────────────────────

    /**
     * @notice Registra uma trilha de auditoria cifrada para o regulador.
     * @dev So' o DvPSettlement (SETTLEMENT_ROLE) pode chamar.
     * @param from Endereco do pagador (publico — partes envolvidas nao sao
     *             privadas, apenas valores e saldos).
     * @param to Endereco do recebedor.
     * @param ciphertext Blob ECIES cifrado off-chain pelo cliente do pagador
     *                   usando a chave publica do regulador (secp256k1).
     * @return txId Sequencial atribuido a este registro.
     */
    function recordTx(
        address from,
        address to,
        bytes calldata ciphertext
    ) external onlyRole(SETTLEMENT_ROLE) returns (uint256 txId) {
        if (ciphertext.length == 0) revert EmptyCiphertext();

        txId = txCount;
        unchecked {
            txCount = txId + 1;
        }

        _records[txId] = EncryptedRecord({
            from: from,
            to: to,
            blockNumber: block.number,
            // solhint-disable-next-line not-rely-on-time
            timestamp: block.timestamp,
            ciphertext: ciphertext
        });

        emit TxRecorded(txId, from, to);
    }

    // ─── Acesso pelo regulador ──────────────────────────────────────────────

    /**
     * @notice Recupera o registro cifrado de uma transacao para auditoria.
     * @dev Espelha LC 105/2001 (sigilo bancario): so' o regulador apropriado
     *      acessa o conteudo. Outros papeis veem apenas metadados via evento.
     * @param txId Sequencial da transacao.
     * @return record Registro completo (decifra off-chain).
     */
    function getEncryptedTx(
        uint256 txId
    ) external view onlyRole(REGULATOR_ROLE) returns (EncryptedRecord memory record) {
        record = _records[txId];
        if (record.ciphertext.length == 0) revert TxNotFound(txId);
    }

    // ─── Views publicas (metadados apenas) ──────────────────────────────────

    /**
     * @notice Retorna apenas metadados publicos da transacao (partes, bloco,
     *         timestamp). Conteudo cifrado nunca e' exposto via essa view.
     */
    function getTxMetadata(
        uint256 txId
    )
        external
        view
        returns (address from, address to, uint256 blockNumber, uint256 timestamp)
    {
        EncryptedRecord storage record = _records[txId];
        if (record.ciphertext.length == 0) revert TxNotFound(txId);
        return (record.from, record.to, record.blockNumber, record.timestamp);
    }
}
