// =============================================================================
// PrivateToken.spec.ts — Testes unitários do contrato PrivateToken.
//
// Cobre:
//   - Construção e papéis de AccessControl
//   - Mint inicial (apenas MINTER_ROLE)
//   - Atualização de commitment (apenas SETTLEMENT_ROLE)
//   - Crypto-shred (apenas REGULATOR_ROLE) — RF06 / LGPD art. 18 VI
//   - Erros customizados para todos os caminhos negativos
// =============================================================================

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { PrivateToken } from "../../typechain-types";

const COMMIT_INITIAL = "0x" + "1a".repeat(32);
const COMMIT_NEW = "0x" + "2b".repeat(32);
const COMMIT_ZERO = "0x" + "00".repeat(32);

describe("PrivateToken", () => {
  let token: PrivateToken;
  let admin: HardhatEthersSigner;
  let minter: HardhatEthersSigner;
  let settlement: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  let MINTER_ROLE: string;
  let SETTLEMENT_ROLE: string;
  let REGULATOR_ROLE: string;
  let DEFAULT_ADMIN_ROLE: string;

  beforeEach(async () => {
    [admin, minter, settlement, regulator, alice, bob, outsider] =
      await ethers.getSigners();

    const factory = await ethers.getContractFactory("PrivateToken");
    token = (await factory.deploy(admin.address)) as unknown as PrivateToken;
    await token.waitForDeployment();

    MINTER_ROLE = await token.MINTER_ROLE();
    SETTLEMENT_ROLE = await token.SETTLEMENT_ROLE();
    REGULATOR_ROLE = await token.REGULATOR_ROLE();
    DEFAULT_ADMIN_ROLE = await token.DEFAULT_ADMIN_ROLE();

    await token.connect(admin).grantRole(MINTER_ROLE, minter.address);
    await token.connect(admin).grantRole(SETTLEMENT_ROLE, settlement.address);
    await token.connect(admin).grantRole(REGULATOR_ROLE, regulator.address);
  });

  describe("metadados do token", () => {
    it("expoe NAME e SYMBOL conforme especificacao", async () => {
      expect(await token.NAME()).to.equal("DREX Privado (PoC)");
      expect(await token.SYMBOL()).to.equal("pDREX");
    });
  });

  describe("AccessControl", () => {
    it("admin recebe DEFAULT_ADMIN_ROLE no constructor", async () => {
      expect(await token.hasRole(DEFAULT_ADMIN_ROLE, admin.address)).to.equal(true);
    });

    it("admin consegue conceder e revogar papeis", async () => {
      const tmp = outsider.address;
      await token.connect(admin).grantRole(MINTER_ROLE, tmp);
      expect(await token.hasRole(MINTER_ROLE, tmp)).to.equal(true);

      await token.connect(admin).revokeRole(MINTER_ROLE, tmp);
      expect(await token.hasRole(MINTER_ROLE, tmp)).to.equal(false);
    });

    it("nao-admin nao consegue conceder papeis", async () => {
      await expect(
        token.connect(outsider).grantRole(MINTER_ROLE, outsider.address)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe("mint (emissao inicial)", () => {
    it("MINTER_ROLE registra commitment inicial", async () => {
      await expect(token.connect(minter).mint(alice.address, COMMIT_INITIAL))
        .to.emit(token, "CommitmentMinted")
        .withArgs(alice.address, COMMIT_INITIAL);

      expect(await token.commitments(alice.address)).to.equal(COMMIT_INITIAL);
      expect(await token.hasCommitment(alice.address)).to.equal(true);
    });

    it("revert se commitment for zero (InvalidCommitment)", async () => {
      await expect(
        token.connect(minter).mint(alice.address, COMMIT_ZERO)
      ).to.be.revertedWithCustomError(token, "InvalidCommitment");
    });

    it("revert se commitment ja existir (CommitmentAlreadyExists)", async () => {
      await token.connect(minter).mint(alice.address, COMMIT_INITIAL);

      await expect(token.connect(minter).mint(alice.address, COMMIT_NEW))
        .to.be.revertedWithCustomError(token, "CommitmentAlreadyExists")
        .withArgs(alice.address);
    });

    it("revert se chamado por endereco sem MINTER_ROLE", async () => {
      await expect(
        token.connect(outsider).mint(alice.address, COMMIT_INITIAL)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe("setCommitment (chamado pelo DvPSettlement)", () => {
    beforeEach(async () => {
      await token.connect(minter).mint(alice.address, COMMIT_INITIAL);
    });

    it("SETTLEMENT_ROLE atualiza commitment e emite evento", async () => {
      await expect(
        token.connect(settlement).setCommitment(alice.address, COMMIT_NEW)
      )
        .to.emit(token, "CommitmentUpdated")
        .withArgs(alice.address, COMMIT_INITIAL, COMMIT_NEW);

      expect(await token.commitments(alice.address)).to.equal(COMMIT_NEW);
    });

    it("revert se novo commitment for zero", async () => {
      await expect(
        token.connect(settlement).setCommitment(alice.address, COMMIT_ZERO)
      ).to.be.revertedWithCustomError(token, "InvalidCommitment");
    });

    it("revert se account nao tem commitment registrado", async () => {
      await expect(
        token.connect(settlement).setCommitment(bob.address, COMMIT_NEW)
      )
        .to.be.revertedWithCustomError(token, "CommitmentNotFound")
        .withArgs(bob.address);
    });

    it("revert se chamado sem SETTLEMENT_ROLE", async () => {
      await expect(
        token.connect(outsider).setCommitment(alice.address, COMMIT_NEW)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });
  });

  describe("cryptoShred (RF06 — LGPD art. 18 VI)", () => {
    beforeEach(async () => {
      await token.connect(minter).mint(alice.address, COMMIT_INITIAL);
    });

    it("REGULATOR_ROLE zera commitment e emite evento", async () => {
      await expect(token.connect(regulator).cryptoShred(alice.address))
        .to.emit(token, "CommitmentShredded")
        .withArgs(alice.address, COMMIT_INITIAL);

      expect(await token.commitments(alice.address)).to.equal(COMMIT_ZERO);
      expect(await token.hasCommitment(alice.address)).to.equal(false);
    });

    it("revert se account nao tem commitment", async () => {
      await expect(token.connect(regulator).cryptoShred(bob.address))
        .to.be.revertedWithCustomError(token, "CommitmentNotFound")
        .withArgs(bob.address);
    });

    it("revert se chamado sem REGULATOR_ROLE", async () => {
      await expect(
        token.connect(outsider).cryptoShred(alice.address)
      ).to.be.revertedWithCustomError(token, "AccessControlUnauthorizedAccount");
    });

    it("apos shred, novo mint do mesmo account e' permitido", async () => {
      await token.connect(regulator).cryptoShred(alice.address);
      await expect(token.connect(minter).mint(alice.address, COMMIT_NEW))
        .to.emit(token, "CommitmentMinted")
        .withArgs(alice.address, COMMIT_NEW);

      expect(await token.commitments(alice.address)).to.equal(COMMIT_NEW);
    });
  });
});
