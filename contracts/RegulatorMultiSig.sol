// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

/**
 * @title RegulatorMultiSig — Carteira multi-sig N-of-M para o REGULATOR_ROLE.
 * @notice Demonstrador de produção: substitui a EOA única que detém o
 *         REGULATOR_ROLE em `PrivateToken` e `RegulatorViewer` por uma
 *         carteira multi-assinatura. Ações sensíveis (crypto-shred, acesso
 *         auditável a registros) só são executadas após M de N proprietários
 *         aprovarem a proposta.
 *
 * Por que multi-sig para o regulador?
 *  - A PoC original concentra TODOS os poderes regulatórios em um único
 *    endereço — ponto de falha único, vulnerável a comprometimento da chave
 *    e politicamente insustentável em ambiente multi-institucional do DREX
 *  - Este contrato exemplifica como distribuir esse poder entre N pessoas
 *    (ex.: 3 oficiais do BCB; 2 precisam concordar) sem alterar a interface
 *    do `RegulatorViewer` ou `PrivateToken` — basta conceder REGULATOR_ROLE
 *    a esta multisig em vez de uma EOA
 *  - Mitiga os vetores STRIDE S2 (spoofing do regulador) e I4 (REGULATOR_ROLE
 *    comprometido); ver THREAT_MODEL.md
 *
 * Modelo:
 *  - N proprietários definidos no construtor (imutável)
 *  - Threshold M (M <= N) configurável no construtor (imutável)
 *  - propose(target, data): qualquer proprietário cria uma proposta
 *  - confirm(id): proprietário aprova; após atingir M confirmações, qualquer
 *    proprietário pode execute(id)
 *  - revoke(id): proprietário retira sua confirmação antes da execução
 *
 * Limitações declaradas (demonstrativo, não Gnosis Safe):
 *  - Sem suporte a transações ETH (regulador não movimenta ETH)
 *  - Sem upgrade dos proprietários (imutável; produção exigiria rotação via
 *    proposta sobre o próprio multisig — meta-governança)
 *  - Sem time-lock (recomendável em produção: delay obrigatório entre M-ésima
 *    confirmação e execução, permitindo veto por minoria)
 */
contract RegulatorMultiSig {
    // ─── Storage ────────────────────────────────────────────────────────────

    address[] public owners;
    mapping(address => bool) public isOwner;
    uint256 public immutable threshold;

    struct Proposal {
        address target;
        bytes data;
        bool executed;
        uint256 confirmations;
    }

    Proposal[] private _proposals;
    mapping(uint256 => mapping(address => bool)) public hasConfirmed;

    // ─── Eventos ────────────────────────────────────────────────────────────

    event ProposalCreated(uint256 indexed id, address indexed proposer, address indexed target);
    event ProposalConfirmed(uint256 indexed id, address indexed by);
    event ProposalRevoked(uint256 indexed id, address indexed by);
    event ProposalExecuted(uint256 indexed id, address indexed by, bool success);

    // ─── Erros ──────────────────────────────────────────────────────────────

    error NotOwner();
    error InvalidConfiguration();
    error UnknownProposal(uint256 id);
    error AlreadyExecuted(uint256 id);
    error AlreadyConfirmed(uint256 id, address by);
    error NotConfirmed(uint256 id, address by);
    error InsufficientConfirmations(uint256 id, uint256 have, uint256 need);
    error CallReverted(uint256 id);

    modifier onlyOwner() {
        if (!isOwner[msg.sender]) revert NotOwner();
        _;
    }

    constructor(address[] memory owners_, uint256 threshold_) {
        if (owners_.length == 0 || threshold_ == 0 || threshold_ > owners_.length) {
            revert InvalidConfiguration();
        }
        for (uint256 i = 0; i < owners_.length; i++) {
            address o = owners_[i];
            if (o == address(0) || isOwner[o]) revert InvalidConfiguration();
            isOwner[o] = true;
            owners.push(o);
        }
        threshold = threshold_;
    }

    /**
     * @notice Cria uma nova proposta de chamada a target com data.
     * @dev O proponente automaticamente confirma. Para executar, sao
     *      necessarias threshold confirmacoes no total.
     */
    function propose(address target, bytes calldata data) external onlyOwner returns (uint256 id) {
        id = _proposals.length;
        _proposals.push(Proposal({ target: target, data: data, executed: false, confirmations: 1 }));
        hasConfirmed[id][msg.sender] = true;
        emit ProposalCreated(id, msg.sender, target);
        emit ProposalConfirmed(id, msg.sender);
    }

    function confirm(uint256 id) external onlyOwner {
        if (id >= _proposals.length) revert UnknownProposal(id);
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyExecuted(id);
        if (hasConfirmed[id][msg.sender]) revert AlreadyConfirmed(id, msg.sender);
        hasConfirmed[id][msg.sender] = true;
        p.confirmations += 1;
        emit ProposalConfirmed(id, msg.sender);
    }

    function revoke(uint256 id) external onlyOwner {
        if (id >= _proposals.length) revert UnknownProposal(id);
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyExecuted(id);
        if (!hasConfirmed[id][msg.sender]) revert NotConfirmed(id, msg.sender);
        hasConfirmed[id][msg.sender] = false;
        p.confirmations -= 1;
        emit ProposalRevoked(id, msg.sender);
    }

    function execute(uint256 id) external onlyOwner {
        if (id >= _proposals.length) revert UnknownProposal(id);
        Proposal storage p = _proposals[id];
        if (p.executed) revert AlreadyExecuted(id);
        if (p.confirmations < threshold) {
            revert InsufficientConfirmations(id, p.confirmations, threshold);
        }
        p.executed = true;
        (bool ok, ) = p.target.call(p.data);
        if (!ok) revert CallReverted(id);
        emit ProposalExecuted(id, msg.sender, ok);
    }

    // ─── Views ──────────────────────────────────────────────────────────────

    function ownerCount() external view returns (uint256) {
        return owners.length;
    }

    function proposalCount() external view returns (uint256) {
        return _proposals.length;
    }

    function getProposal(
        uint256 id
    ) external view returns (address target, bytes memory data, bool executed, uint256 confirmations) {
        if (id >= _proposals.length) revert UnknownProposal(id);
        Proposal storage p = _proposals[id];
        return (p.target, p.data, p.executed, p.confirmations);
    }
}
