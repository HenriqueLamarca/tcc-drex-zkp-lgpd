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
        // Empacotamento de storage: from(20B) + blockNumber(uint48) +
        // timestamp(uint48) preenchem exatamente 1 slot (32B); to(20B) ocupa
        // outro. Antes eram 4 slots (2 enderecos + 2 uint256); agora 2, poupando
        // ~2 SSTORE frios (~40k gas) por liquidacao. uint48 cobre numero de bloco
        // e timestamp Unix por ~8,9 milhoes de anos — folga de sobra. A interface
        // publica nao muda: getTxMetadata e accessEncryptedTx seguem expondo os
        // mesmos valores (uint48 alarga para uint256 na leitura).
        address from;
        uint48 blockNumber;
        uint48 timestamp;
        address to;
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

    /// @notice Emitido quando o regulador acessa o conteudo cifrado de uma
    ///         transacao pela via auditavel (accessEncryptedTx).
    /// @dev Materializa a nao-repudiacao do acesso do regulador
    ///      (THREAT_MODEL R2): o acesso fica registrado imutavelmente
    ///      on-chain, espelhando a responsabilizacao da LC 105/2001 e o
    ///      principio de responsabilizacao da LGPD (art. 6º, X).
    event RegulatorAccessed(
        uint256 indexed txId,
        address indexed regulator,
        uint256 timestamp
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
            blockNumber: uint48(block.number),
            // solhint-disable-next-line not-rely-on-time
            timestamp: uint48(block.timestamp),
            to: to,
            ciphertext: ciphertext
        });

        emit TxRecorded(txId, from, to);
    }

    // ─── Acesso pelo regulador ──────────────────────────────────────────────

    /**
     * @notice Acesso AUDITAVEL ao registro cifrado — via canonica do regulador.
     * @dev Diferente de getEncryptedTx (view, sem rastro), esta funcao emite
     *      RegulatorAccessed, deixando trilha imutavel on-chain de QUEM acessou
     *      O QUE e QUANDO. Fecha o vetor R2 (Repudiation) do THREAT_MODEL: o
     *      regulador nao pode negar ter consultado um registro especifico.
     *      Procedimento institucional deve usar esta funcao, nao getEncryptedTx.
     * @param txId Sequencial da transacao.
     * @return record Registro completo (decifra off-chain).
     */
    function accessEncryptedTx(
        uint256 txId
    ) external onlyRole(REGULATOR_ROLE) returns (EncryptedRecord memory record) {
        record = _records[txId];
        if (record.ciphertext.length == 0) revert TxNotFound(txId);

        // solhint-disable-next-line not-rely-on-time
        emit RegulatorAccessed(txId, msg.sender, block.timestamp);
    }

    /**
     * @notice Leitura SEM trilha do registro cifrado (conveniencia/inspecao).
     * @dev View — nao emite evento nem custa gas. Uso governado por politica
     *      interna; a via auditavel oficial e' accessEncryptedTx. Mantida para
     *      inspecao rapida off-chain e testes.
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
