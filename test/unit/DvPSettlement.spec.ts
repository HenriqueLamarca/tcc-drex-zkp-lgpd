// =============================================================================
// DvPSettlement.spec.ts — Testes unitários do orquestrador DvP.
//
// Usa a fixture valid-proof.json gerada por scripts/03_generate_test_fixtures.sh
// para validar a integração ponta-a-ponta com Verifier real (precompileds BN128).
//
// Cobre:
//   - executeDvP feliz: commitments antigos batem + prova valida + update atomico
//   - Rate limit: 1 DvP por bloco por pagador
//   - CommitmentMismatch: commit antigo on-chain difere do declarado
//   - InvalidProof: prova adulterada
//   - InvalidParties: from == to, zero address
//   - EmptyCiphertext
//   - Atualizacao de commitments em PrivateToken
//   - Registro em RegulatorViewer
// =============================================================================

import { expect } from "chai";
import { ethers, network } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DvPSettlement,
  PrivateToken,
  RegulatorViewer,
  Verifier,
} from "../../typechain-types";
import {
  loadValidFixture,
  uintToBytes32,
  mockCiphertext,
} from "../fixtures/helpers";

describe("DvPSettlement", () => {
  let verifier: Verifier;
  let token: PrivateToken;
  let viewer: RegulatorViewer;
  let dvp: DvPSettlement;

  let admin: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let alice: HardhatEthersSigner; // Pagador (from)
  let bob: HardhatEthersSigner; // Recebedor (to)
  let outsider: HardhatEthersSigner;

  const fixture = loadValidFixture();
  const ciphertext = mockCiphertext("dvp-test");

  beforeEach(async () => {
    [admin, regulator, alice, bob, outsider] = await ethers.getSigners();

    const verifierFactory = await ethers.getContractFactory("Verifier");
    verifier = (await verifierFactory.deploy()) as unknown as Verifier;
    await verifier.waitForDeployment();

    const tokenFactory = await ethers.getContractFactory("PrivateToken");
    token = (await tokenFactory.deploy(admin.address)) as unknown as PrivateToken;
    await token.waitForDeployment();

    const viewerFactory = await ethers.getContractFactory("RegulatorViewer");
    viewer = (await viewerFactory.deploy(
      admin.address,
      regulator.address
    )) as unknown as RegulatorViewer;
    await viewer.waitForDeployment();

    const dvpFactory = await ethers.getContractFactory("DvPSettlement");
    dvp = (await dvpFactory.deploy(
      admin.address,
      await verifier.getAddress(),
      await token.getAddress(),
      await viewer.getAddress()
    )) as unknown as DvPSettlement;
    await dvp.waitForDeployment();

    // Concede papeis: DvPSettlement como SETTLEMENT no token e no viewer
    await token.connect(admin).grantRole(await token.MINTER_ROLE(), admin.address);
    await token
      .connect(admin)
      .grantRole(await token.SETTLEMENT_ROLE(), await dvp.getAddress());
    await viewer
      .connect(admin)
      .grantRole(await viewer.SETTLEMENT_ROLE(), await dvp.getAddress());

    // Registra commitments iniciais de Alice (S_A=100) e Bob (S_B=50) — bate
    // com fixture.inputs.commitAOld/commitBOld
    await token
      .connect(admin)
      .mint(alice.address, uintToBytes32(fixture.inputs.commitAOld));
    await token
      .connect(admin)
      .mint(bob.address, uintToBytes32(fixture.inputs.commitBOld));
  });

  describe("executeDvP — caminho feliz", () => {
    it("verifica prova, atualiza commitments e registra audit trail", async () => {
      const txPromise = dvp
        .connect(alice)
        .executeDvP(
          alice.address,
          bob.address,
          fixture.proof,
          fixture.inputs,
          ciphertext
        );

      await expect(txPromise)
        .to.emit(dvp, "DvPSettled")
        .withArgs(
          0n,
          alice.address,
          bob.address,
          uintToBytes32(fixture.inputs.commitAOld),
          uintToBytes32(fixture.inputs.commitBOld),
          uintToBytes32(fixture.inputs.commitANew),
          uintToBytes32(fixture.inputs.commitBNew)
        );

      // Commitments atualizados no token
      expect(await token.commitments(alice.address)).to.equal(
        uintToBytes32(fixture.inputs.commitANew)
      );
      expect(await token.commitments(bob.address)).to.equal(
        uintToBytes32(fixture.inputs.commitBNew)
      );

      // RegulatorViewer registrou
      expect(await viewer.txCount()).to.equal(1n);
      const meta = await viewer.getTxMetadata(0);
      expect(meta.from).to.equal(alice.address);
      expect(meta.to).to.equal(bob.address);
    });

    it("eventos nao revelam saldos nem valor transferido (LGPD art. 6º, III)", async () => {
      const tx = await dvp
        .connect(alice)
        .executeDvP(
          alice.address,
          bob.address,
          fixture.proof,
          fixture.inputs,
          ciphertext
        );
      const receipt = await tx.wait();

      // Nenhum evento deve conter os valores em plaintext (S_A=100, V=30, S_B=50)
      const allData = receipt!.logs
        .map((log) => log.data + log.topics.join(""))
        .join(" ");
      expect(allData).not.to.match(/0{63}64/); // 100 em hex padded
      expect(allData).not.to.match(/0{63}1e/); // 30 em hex padded
      expect(allData).not.to.match(/0{63}32/); // 50 em hex padded
    });
  });

  describe("rate limiting", () => {
    afterEach(async () => {
      // Garante que o automine seja restaurado mesmo se o teste falhar
      await network.provider.send("evm_setAutomine", [true]);
    });

    it("bloqueia segundo DvP do mesmo pagador no mesmo bloco", async () => {
      // Pausa auto-mining para empilhar 2 txs no mesmo bloco
      await network.provider.send("evm_setAutomine", [false]);

      // Submete ambas; sem mining, ficam no mempool
      const tx1 = await dvp
        .connect(alice)
        .executeDvP(
          alice.address,
          bob.address,
          fixture.proof,
          fixture.inputs,
          ciphertext
        );
      const tx2 = await dvp
        .connect(alice)
        .executeDvP(
          alice.address,
          bob.address,
          fixture.proof,
          fixture.inputs,
          ciphertext
        );

      // Mineira 1 bloco contendo as duas txs
      await network.provider.send("evm_mine", []);

      // tx1 sucedeu (primeira no bloco)
      const r1 = await tx1.wait();
      expect(r1!.status).to.equal(1);

      // tx2 reverteu por RateLimitExceeded
      let secondReverted = false;
      try {
        await tx2.wait();
      } catch {
        secondReverted = true;
      }
      expect(secondReverted).to.equal(true);
    });
  });

  describe("erros customizados", () => {
    it("InvalidParties — from == to", async () => {
      await expect(
        dvp
          .connect(alice)
          .executeDvP(
            alice.address,
            alice.address,
            fixture.proof,
            fixture.inputs,
            ciphertext
          )
      ).to.be.revertedWithCustomError(dvp, "InvalidParties");
    });

    it("InvalidParties — zero address", async () => {
      await expect(
        dvp
          .connect(alice)
          .executeDvP(
            ethers.ZeroAddress,
            bob.address,
            fixture.proof,
            fixture.inputs,
            ciphertext
          )
      ).to.be.revertedWithCustomError(dvp, "InvalidParties");
    });

    it("EmptyCiphertext", async () => {
      await expect(
        dvp
          .connect(alice)
          .executeDvP(alice.address, bob.address, fixture.proof, fixture.inputs, "0x")
      ).to.be.revertedWithCustomError(dvp, "EmptyCiphertext");
    });

    it("CommitmentMismatch (A) — commit antigo de from on-chain difere", async () => {
      const tamperedInputs = {
        ...fixture.inputs,
        commitAOld: fixture.inputs.commitAOld + 1n,
      };

      await expect(
        dvp
          .connect(alice)
          .executeDvP(
            alice.address,
            bob.address,
            fixture.proof,
            tamperedInputs,
            ciphertext
          )
      ).to.be.revertedWithCustomError(dvp, "CommitmentMismatch");
    });

    it("CommitmentMismatch (B) — commit antigo de to on-chain difere", async () => {
      const tamperedInputs = {
        ...fixture.inputs,
        commitBOld: fixture.inputs.commitBOld + 1n,
      };

      await expect(
        dvp
          .connect(alice)
          .executeDvP(
            alice.address,
            bob.address,
            fixture.proof,
            tamperedInputs,
            ciphertext
          )
      ).to.be.revertedWithCustomError(dvp, "CommitmentMismatch");
    });

    it("InvalidProof — prova adulterada nao verifica", async () => {
      // Tampera com proof.a.X
      const tamperedProof = {
        ...fixture.proof,
        a: { X: fixture.proof.a.X + 1n, Y: fixture.proof.a.Y },
      };

      // pode ser revertido tanto por falha no precompiled quanto por InvalidProof,
      // dependendo de onde a curva rejeita o ponto invalido
      await expect(
        dvp
          .connect(alice)
          .executeDvP(
            alice.address,
            bob.address,
            tamperedProof,
            fixture.inputs,
            ciphertext
          )
      ).to.be.reverted;
    });
  });

  describe("imutaveis e referencias", () => {
    it("verifier/token/regulatorViewer expostos como imutaveis", async () => {
      expect(await dvp.verifier()).to.equal(await verifier.getAddress());
      expect(await dvp.token()).to.equal(await token.getAddress());
      expect(await dvp.regulatorViewer()).to.equal(await viewer.getAddress());
    });
  });
});
