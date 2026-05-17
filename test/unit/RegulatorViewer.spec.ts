// =============================================================================
// RegulatorViewer.spec.ts — Testes unitários da trilha cifrada do regulador.
//
// Cobre:
//   - Construção com admin e regulador opcionais
//   - recordTx (apenas SETTLEMENT_ROLE) e atribuição sequencial de txId
//   - getEncryptedTx (apenas REGULATOR_ROLE) e isolamento de outros papéis
//   - getTxMetadata (publico) — partes/bloco/timestamp sem ciphertext
//   - Erros customizados para todos os caminhos negativos
// =============================================================================

import { expect } from "chai";
import { ethers } from "hardhat";
import { anyUint } from "@nomicfoundation/hardhat-chai-matchers/withArgs";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { RegulatorViewer } from "../../typechain-types";

const CIPHER_1 = "0x" + Buffer.from("ECIES_BLOB_1", "utf-8").toString("hex");
const CIPHER_2 = "0x" + Buffer.from("ECIES_BLOB_2", "utf-8").toString("hex");
const CIPHER_EMPTY = "0x";

describe("RegulatorViewer", () => {
  let viewer: RegulatorViewer;
  let admin: HardhatEthersSigner;
  let settlement: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let outsider: HardhatEthersSigner;

  let SETTLEMENT_ROLE: string;
  let REGULATOR_ROLE: string;

  beforeEach(async () => {
    [admin, settlement, regulator, alice, bob, outsider] = await ethers.getSigners();

    const factory = await ethers.getContractFactory("RegulatorViewer");
    viewer = (await factory.deploy(
      admin.address,
      regulator.address
    )) as unknown as RegulatorViewer;
    await viewer.waitForDeployment();

    SETTLEMENT_ROLE = await viewer.SETTLEMENT_ROLE();
    REGULATOR_ROLE = await viewer.REGULATOR_ROLE();

    await viewer.connect(admin).grantRole(SETTLEMENT_ROLE, settlement.address);
  });

  describe("construtor", () => {
    it("admin recebe DEFAULT_ADMIN_ROLE e regulator recebe REGULATOR_ROLE", async () => {
      expect(await viewer.hasRole(await viewer.DEFAULT_ADMIN_ROLE(), admin.address)).to.equal(true);
      expect(await viewer.hasRole(REGULATOR_ROLE, regulator.address)).to.equal(true);
    });

    it("aceita address zero como regulator (papel concedido depois)", async () => {
      const factory = await ethers.getContractFactory("RegulatorViewer");
      const v2 = await factory.deploy(admin.address, ethers.ZeroAddress);
      await v2.waitForDeployment();

      expect(await v2.hasRole(REGULATOR_ROLE, ethers.ZeroAddress)).to.equal(false);
    });

    it("txCount inicia em zero", async () => {
      expect(await viewer.txCount()).to.equal(0n);
    });
  });

  describe("recordTx (SETTLEMENT_ROLE)", () => {
    it("registra transacao e retorna txId sequencial", async () => {
      const tx = await viewer.connect(settlement).recordTx(alice.address, bob.address, CIPHER_1);
      await expect(tx)
        .to.emit(viewer, "TxRecorded")
        .withArgs(0n, alice.address, bob.address);

      expect(await viewer.txCount()).to.equal(1n);

      const tx2 = await viewer.connect(settlement).recordTx(bob.address, alice.address, CIPHER_2);
      await expect(tx2)
        .to.emit(viewer, "TxRecorded")
        .withArgs(1n, bob.address, alice.address);

      expect(await viewer.txCount()).to.equal(2n);
    });

    it("revert com EmptyCiphertext se ciphertext vazio", async () => {
      await expect(
        viewer.connect(settlement).recordTx(alice.address, bob.address, CIPHER_EMPTY)
      ).to.be.revertedWithCustomError(viewer, "EmptyCiphertext");
    });

    it("revert se chamado sem SETTLEMENT_ROLE", async () => {
      await expect(
        viewer.connect(outsider).recordTx(alice.address, bob.address, CIPHER_1)
      ).to.be.revertedWithCustomError(viewer, "AccessControlUnauthorizedAccount");
    });
  });

  describe("getEncryptedTx (REGULATOR_ROLE)", () => {
    beforeEach(async () => {
      await viewer.connect(settlement).recordTx(alice.address, bob.address, CIPHER_1);
    });

    it("regulator recupera registro completo com ciphertext", async () => {
      const record = await viewer.connect(regulator).getEncryptedTx(0);
      expect(record.from).to.equal(alice.address);
      expect(record.to).to.equal(bob.address);
      expect(record.ciphertext).to.equal(CIPHER_1);
      expect(record.blockNumber).to.be.greaterThan(0n);
      expect(record.timestamp).to.be.greaterThan(0n);
    });

    it("revert TxNotFound para txId inexistente", async () => {
      await expect(viewer.connect(regulator).getEncryptedTx(999))
        .to.be.revertedWithCustomError(viewer, "TxNotFound")
        .withArgs(999n);
    });

    it("revert se chamado sem REGULATOR_ROLE — protege LC 105/2001", async () => {
      await expect(
        viewer.connect(outsider).getEncryptedTx(0)
      ).to.be.revertedWithCustomError(viewer, "AccessControlUnauthorizedAccount");

      await expect(
        viewer.connect(settlement).getEncryptedTx(0)
      ).to.be.revertedWithCustomError(viewer, "AccessControlUnauthorizedAccount");
    });
  });

  describe("accessEncryptedTx (via auditavel — THREAT_MODEL R2)", () => {
    beforeEach(async () => {
      await viewer.connect(settlement).recordTx(alice.address, bob.address, CIPHER_1);
    });

    it("emite RegulatorAccessed registrando quem/o que/quando", async () => {
      await expect(viewer.connect(regulator).accessEncryptedTx(0))
        .to.emit(viewer, "RegulatorAccessed")
        .withArgs(0n, regulator.address, anyUint);
    });

    it("retorna o registro completo (via staticCall)", async () => {
      const record = await viewer
        .connect(regulator)
        .accessEncryptedTx.staticCall(0);
      expect(record.from).to.equal(alice.address);
      expect(record.to).to.equal(bob.address);
      expect(record.ciphertext).to.equal(CIPHER_1);
    });

    it("cria trilha imutavel: acesso fica no recibo da transacao", async () => {
      const tx = await viewer.connect(regulator).accessEncryptedTx(0);
      const receipt = await tx.wait();
      const logs = receipt!.logs.filter(
        (l) => "fragment" in l && l.fragment?.name === "RegulatorAccessed"
      );
      expect(logs.length).to.equal(1);
    });

    it("revert TxNotFound para txId inexistente", async () => {
      await expect(viewer.connect(regulator).accessEncryptedTx(999))
        .to.be.revertedWithCustomError(viewer, "TxNotFound")
        .withArgs(999n);
    });

    it("revert se chamado sem REGULATOR_ROLE", async () => {
      await expect(
        viewer.connect(outsider).accessEncryptedTx(0)
      ).to.be.revertedWithCustomError(viewer, "AccessControlUnauthorizedAccount");
      await expect(
        viewer.connect(settlement).accessEncryptedTx(0)
      ).to.be.revertedWithCustomError(viewer, "AccessControlUnauthorizedAccount");
    });
  });

  describe("getTxMetadata (publico)", () => {
    beforeEach(async () => {
      await viewer.connect(settlement).recordTx(alice.address, bob.address, CIPHER_1);
    });

    it("qualquer endereco pode ler metadados (sem ciphertext)", async () => {
      const meta = await viewer.connect(outsider).getTxMetadata(0);
      expect(meta.from).to.equal(alice.address);
      expect(meta.to).to.equal(bob.address);
      expect(meta.blockNumber).to.be.greaterThan(0n);
      expect(meta.timestamp).to.be.greaterThan(0n);
    });

    it("revert TxNotFound para txId inexistente", async () => {
      await expect(viewer.connect(outsider).getTxMetadata(99))
        .to.be.revertedWithCustomError(viewer, "TxNotFound")
        .withArgs(99n);
    });
  });
});
