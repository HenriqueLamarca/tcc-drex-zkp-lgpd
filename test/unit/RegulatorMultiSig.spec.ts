// =============================================================================
// RegulatorMultiSig.spec.ts — Testes do multi-sig demonstrativo do regulador.
//
// Cobre:
//   - Construção (validação de owners + threshold)
//   - propose: apenas owners; auto-confirmação do proponente
//   - confirm: idempotência rejeitada; soma de confirmações
//   - revoke: retira confirmação antes de executar
//   - execute: requer threshold; idempotência rejeitada após executado
//   - INTEGRAÇÃO REAL: multisig recebe REGULATOR_ROLE em PrivateToken e
//     executa cryptoShred (operação que UMA EOA isolada não poderia fazer)
// =============================================================================

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PrivateToken, RegulatorMultiSig } from "../../typechain-types";

const COMMIT = "0x" + "1a".repeat(32);

describe("RegulatorMultiSig", () => {
  let multisig: RegulatorMultiSig;
  let token: PrivateToken;
  let admin: HardhatEthersSigner;
  let reg1: HardhatEthersSigner;
  let reg2: HardhatEthersSigner;
  let reg3: HardhatEthersSigner;
  let intruder: HardhatEthersSigner;
  let titular: HardhatEthersSigner;

  beforeEach(async () => {
    [admin, reg1, reg2, reg3, intruder, titular] = await ethers.getSigners();

    const MSFactory = await ethers.getContractFactory("RegulatorMultiSig");
    multisig = (await MSFactory.deploy(
      [reg1.address, reg2.address, reg3.address],
      2
    )) as unknown as RegulatorMultiSig;
    await multisig.waitForDeployment();

    const TFactory = await ethers.getContractFactory("PrivateToken");
    token = (await TFactory.deploy(admin.address)) as unknown as PrivateToken;
    await token.waitForDeployment();
    // O multisig recebe REGULATOR_ROLE — substitui a EOA unica.
    await token.connect(admin).grantRole(await token.MINTER_ROLE(), admin.address);
    await token
      .connect(admin)
      .grantRole(await token.REGULATOR_ROLE(), await multisig.getAddress());

    // Titular tem um commitment para ser eliminado
    await token.connect(admin).mint(titular.address, COMMIT);
  });

  describe("construtor", () => {
    it("registra os 3 owners e threshold=2", async () => {
      expect(await multisig.ownerCount()).to.equal(3n);
      expect(await multisig.threshold()).to.equal(2n);
      expect(await multisig.isOwner(reg1.address)).to.equal(true);
      expect(await multisig.isOwner(reg2.address)).to.equal(true);
      expect(await multisig.isOwner(reg3.address)).to.equal(true);
      expect(await multisig.isOwner(intruder.address)).to.equal(false);
    });

    it("revert se threshold for zero ou maior que N", async () => {
      const F = await ethers.getContractFactory("RegulatorMultiSig");
      await expect(
        F.deploy([reg1.address, reg2.address], 0)
      ).to.be.revertedWithCustomError(multisig, "InvalidConfiguration");
      await expect(
        F.deploy([reg1.address, reg2.address], 3)
      ).to.be.revertedWithCustomError(multisig, "InvalidConfiguration");
    });

    it("revert se lista de owners tem duplicata", async () => {
      const F = await ethers.getContractFactory("RegulatorMultiSig");
      await expect(
        F.deploy([reg1.address, reg1.address, reg2.address], 2)
      ).to.be.revertedWithCustomError(multisig, "InvalidConfiguration");
    });
  });

  describe("propose / confirm / execute", () => {
    let callData: string;
    beforeEach(() => {
      // payload: token.cryptoShred(titular.address)
      callData = token.interface.encodeFunctionData("cryptoShred", [titular.address]);
    });

    it("UMA aprovação NÃO basta — chamar execute antes do threshold reverte", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await expect(multisig.connect(reg1).execute(0))
        .to.be.revertedWithCustomError(multisig, "InsufficientConfirmations")
        .withArgs(0n, 1n, 2n);
    });

    it("2 aprovações + execute → cryptoShred funciona (multi-sig opera REGULATOR_ROLE)", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      // reg1 ja confirmou na proposta; reg2 confirma agora -> threshold atingido
      await multisig.connect(reg2).confirm(0);

      await expect(multisig.connect(reg3).execute(0))
        .to.emit(token, "CommitmentShredded")
        .withArgs(titular.address, COMMIT);

      expect(await token.commitments(titular.address)).to.equal(ethers.ZeroHash);
    });

    it("non-owner não pode propor, confirmar ou executar", async () => {
      await expect(
        multisig.connect(intruder).propose(await token.getAddress(), callData)
      ).to.be.revertedWithCustomError(multisig, "NotOwner");

      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await expect(multisig.connect(intruder).confirm(0)).to.be.revertedWithCustomError(
        multisig,
        "NotOwner"
      );
      await expect(multisig.connect(intruder).execute(0)).to.be.revertedWithCustomError(
        multisig,
        "NotOwner"
      );
    });

    it("dupla confirmação do mesmo owner é rejeitada", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await expect(multisig.connect(reg1).confirm(0)).to.be.revertedWithCustomError(
        multisig,
        "AlreadyConfirmed"
      );
    });

    it("revoke retira a confirmação e reduz o contador", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await multisig.connect(reg2).confirm(0);
      // Antes: 2 conf (atingiu threshold). reg2 revoga -> volta a 1.
      await multisig.connect(reg2).revoke(0);
      const p = await multisig.getProposal(0);
      expect(p.confirmations).to.equal(1n);
      // E nao executa
      await expect(multisig.connect(reg1).execute(0))
        .to.be.revertedWithCustomError(multisig, "InsufficientConfirmations")
        .withArgs(0n, 1n, 2n);
    });

    it("execute duplicada é rejeitada (idempotência)", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await multisig.connect(reg2).confirm(0);
      await multisig.connect(reg3).execute(0);
      await expect(multisig.connect(reg3).execute(0)).to.be.revertedWithCustomError(
        multisig,
        "AlreadyExecuted"
      );
    });

    it("views: ownerCount, proposalCount, getProposal", async () => {
      expect(await multisig.proposalCount()).to.equal(0n);
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      expect(await multisig.proposalCount()).to.equal(1n);
      const p = await multisig.getProposal(0);
      expect(p.target).to.equal(await token.getAddress());
      expect(p.executed).to.equal(false);
      expect(p.confirmations).to.equal(1n);
      await expect(multisig.getProposal(99)).to.be.revertedWithCustomError(
        multisig,
        "UnknownProposal"
      );
    });

    it("operações em proposta inexistente revertem com UnknownProposal", async () => {
      await expect(multisig.connect(reg1).confirm(99)).to.be.revertedWithCustomError(
        multisig,
        "UnknownProposal"
      );
      await expect(multisig.connect(reg1).revoke(99)).to.be.revertedWithCustomError(
        multisig,
        "UnknownProposal"
      );
      await expect(multisig.connect(reg1).execute(99)).to.be.revertedWithCustomError(
        multisig,
        "UnknownProposal"
      );
    });

    it("revoke sem ter confirmado é rejeitada", async () => {
      await multisig.connect(reg1).propose(await token.getAddress(), callData);
      await expect(multisig.connect(reg2).revoke(0)).to.be.revertedWithCustomError(
        multisig,
        "NotConfirmed"
      );
    });

    it("execute propaga revert do target (call falhou)", async () => {
      // tenta shred de endereco sem commitment → token reverte com CommitmentNotFound
      const badCall = token.interface.encodeFunctionData("cryptoShred", [
        intruder.address,
      ]);
      await multisig.connect(reg1).propose(await token.getAddress(), badCall);
      await multisig.connect(reg2).confirm(0);
      await expect(multisig.connect(reg1).execute(0)).to.be.revertedWithCustomError(
        multisig,
        "CallReverted"
      );
    });
  });
});
