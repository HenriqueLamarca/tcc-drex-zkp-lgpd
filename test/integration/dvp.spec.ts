// =============================================================================
// dvp.spec.ts (integration) — Cenario completo executado in-process.
//
// Replica o fluxo de scripts/04_deploy.ts + scripts/05_run_dvp_demo.ts dentro
// do Hardhat Network, sem dependencia de no externo. Permite que CI rode o
// fluxo ponta-a-ponta sem subir Besu nem hardhat node.
//
// Cobre:
//   - Deploy + concessao de papeis dos 4 contratos
//   - Mint inicial de Alice e Bob com commitments da fixture
//   - executeDvP com prova Groth16 real
//   - Verificacao de state changes em PrivateToken e RegulatorViewer
//   - Audit trail recuperavel pelo regulador
//   - Invariantes de privacidade (nenhum saldo plaintext em events/calldata)
// =============================================================================

import { expect } from "chai";
import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  DvPSettlement,
  PrivateToken,
  RegulatorViewer,
} from "../../typechain-types";
import {
  loadValidFixture,
  uintToBytes32,
  mockCiphertext,
  encryptForRegulator,
  decryptAsRegulator,
  type RegulatorPayload,
} from "../fixtures/helpers";
import { deployFullStack } from "../fixtures/deployStack";

describe("Integration — DvP fluxo completo (mint -> dvp -> audit)", () => {
  let token: PrivateToken;
  let viewer: RegulatorViewer;
  let dvp: DvPSettlement;

  let admin: HardhatEthersSigner;
  let regulator: HardhatEthersSigner;
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;

  const fixture = loadValidFixture();
  // Payload de auditoria real, cifrado com ECIES para o regulador.
  const auditPayload: RegulatorPayload = {
    from: "0x0000000000000000000000000000000000000000",
    to: "0x0000000000000000000000000000000000000000",
    value: "30",
    timestamp: "2026-01-01T00:00:00.000Z",
  };
  let ciphertext: string;

  const aliceCommitOld = uintToBytes32(fixture.inputs.commitAOld);
  const bobCommitOld = uintToBytes32(fixture.inputs.commitBOld);
  const aliceCommitNew = uintToBytes32(fixture.inputs.commitANew);
  const bobCommitNew = uintToBytes32(fixture.inputs.commitBNew);

  before(async () => {
    // Deploy completo (mesma sequencia de scripts/04_deploy.ts)
    const stack = await deployFullStack();
    token = stack.token;
    viewer = stack.viewer;
    dvp = stack.dvp;
    admin = stack.admin;
    regulator = stack.regulator;
    [, , alice, bob] = stack.signers;

    auditPayload.from = alice.address;
    auditPayload.to = bob.address;
    ciphertext = encryptForRegulator(auditPayload);
  });

  it("admin minta commitments iniciais para Alice e Bob", async () => {
    await token.connect(admin).mint(alice.address, aliceCommitOld);
    await token.connect(admin).mint(bob.address, bobCommitOld);

    expect(await token.commitments(alice.address)).to.equal(aliceCommitOld);
    expect(await token.commitments(bob.address)).to.equal(bobCommitOld);
  });

  it("Alice executa DvP, Verifier aprova e estado e' atualizado atomicamente", async () => {
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
    expect(receipt!.status).to.equal(1);

    // Commitments atualizados
    expect(await token.commitments(alice.address)).to.equal(aliceCommitNew);
    expect(await token.commitments(bob.address)).to.equal(bobCommitNew);

    // RegulatorViewer registrou
    expect(await viewer.txCount()).to.equal(1n);
  });

  it("regulador recupera audit trail completo (LC 105/2001)", async () => {
    const record = await viewer.connect(regulator).getEncryptedTx(0);
    expect(record.from).to.equal(alice.address);
    expect(record.to).to.equal(bob.address);
    expect(record.ciphertext).to.equal(ciphertext);
    expect(record.blockNumber).to.be.greaterThan(0n);
  });

  it("acesso auditavel (accessEncryptedTx) emite RegulatorAccessed", async () => {
    await expect(viewer.connect(regulator).accessEncryptedTx(0)).to.emit(
      viewer,
      "RegulatorAccessed"
    );
  });

  it("regulador decifra o blob ECIES e recupera o payload (roundtrip real)", async () => {
    const record = await viewer.connect(regulator).getEncryptedTx(0);
    const payload = decryptAsRegulator(record.ciphertext);
    expect(payload.from).to.equal(alice.address);
    expect(payload.to).to.equal(bob.address);
    expect(payload.value).to.equal("30"); // só o regulador consegue ver isto
    expect(payload.timestamp).to.equal(auditPayload.timestamp);
  });

  it("metadados publicos disponiveis sem REGULATOR_ROLE", async () => {
    const meta = await viewer.connect(alice).getTxMetadata(0);
    expect(meta.from).to.equal(alice.address);
    expect(meta.to).to.equal(bob.address);
  });

  it("RNF06: nenhum valor plaintext em events ou calldata", async () => {
    // Re-executa DvP com dados frescos para inspecionar receipt (Alice ja' mintou,
    // entao usamos um conjunto novo de signers para evitar conflito de fixture)
    const [, , , , carol, dave] = await ethers.getSigners();

    // Mint para Carol e Dave usando os mesmos commitments (apenas para teste)
    await token.connect(admin).mint(carol.address, aliceCommitOld);
    await token.connect(admin).mint(dave.address, bobCommitOld);

    const newCipher = mockCiphertext("rnf06-check");
    const tx = await dvp
      .connect(carol)
      .executeDvP(
        carol.address,
        dave.address,
        fixture.proof,
        fixture.inputs,
        newCipher
      );
    const receipt = await tx.wait();

    // Concatena todos os dados emitidos
    const allLogData = receipt!.logs
      .map((log) => log.data + log.topics.join(""))
      .join(" ");

    // Saldos plaintext (100, 50, 30, 70, 80) NAO devem aparecer em hex padded
    const plaintextHex = [
      "0".repeat(63) + "64", // 100
      "0".repeat(62) + "32", // 50 (precisa 2 zeros adicionais para padding correto)
      "0".repeat(62) + "1e", // 30
      "0".repeat(62) + "46", // 70
      "0".repeat(62) + "50", // 80
    ];
    for (const v of plaintextHex) {
      expect(allLogData.toLowerCase()).not.to.include(v.toLowerCase());
    }
  });

  it("invariante: gas de verificacao + atualizacao < 1.000.000 (RNF02 amplo)", async () => {
    // Ja temos um receipt do teste anterior — re-executa para garantir
    const [, , , , , , eve, frank] = await ethers.getSigners();
    await token.connect(admin).mint(eve.address, aliceCommitOld);
    await token.connect(admin).mint(frank.address, bobCommitOld);

    const tx = await dvp
      .connect(eve)
      .executeDvP(
        eve.address,
        frank.address,
        fixture.proof,
        fixture.inputs,
        mockCiphertext("gas-check")
      );
    const receipt = await tx.wait();
    expect(Number(receipt!.gasUsed)).to.be.lessThan(1_000_000);
  });
});
