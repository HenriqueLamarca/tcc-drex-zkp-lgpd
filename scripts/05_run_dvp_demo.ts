// =============================================================================
// 05_run_dvp_demo.ts — Cenario ponta-a-ponta DvP no DREX-PoC.
//
// Pre-requisitos:
//   1. Setup ZoKrates: bash scripts/01_setup_zkp.sh
//   2. Fixture de prova: bash scripts/03_generate_test_fixtures.sh
//   3. Deploy: npx hardhat run scripts/04_deploy.ts --network <rede>
//
// Cenario (mesmo do smoke test T1 e da fixture):
//   - Alice (S_A=100) transfere V=30 para Bob (S_B=50)
//   - Saldos finais: Alice=70, Bob=80 (provados internamente, nao revelados)
//
// Fluxo:
//   1. Carrega deployment JSON da rede atual
//   2. Mint inicial dos commitments de Alice e Bob (idempotente)
//   3. Cifra payload mock para regulador (em prod: ECIES real)
//   4. Submete prova Groth16 + 4 inputs publicos ao DvPSettlement
//   5. Verifica state changes: commitments updated, txCount++
//   6. Regulador recupera audit trail (getEncryptedTx)
//   7. Imprime JSON estruturado — sem saldos/valores em plaintext (RNF06)
//
// Uso:
//   npx hardhat run scripts/05_run_dvp_demo.ts --network besu
//   npx hardhat run scripts/05_run_dvp_demo.ts --network localhost
// =============================================================================

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import {
  loadValidFixture,
  uintToBytes32,
  mockCiphertext,
} from "../test/fixtures/helpers";

interface Deployment {
  contracts: {
    Verifier: string;
    PrivateToken: string;
    RegulatorViewer: string;
    DvPSettlement: string;
  };
  deployer: string;
  regulator: string;
}

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

async function main(): Promise<void> {
  const deploymentFile = path.join(
    __dirname,
    "..",
    "deployments",
    `${network.name}.json`
  );

  if (!fs.existsSync(deploymentFile)) {
    throw new Error(
      `Deployment nao encontrado para rede ${network.name}. Rode primeiro: npx hardhat run scripts/04_deploy.ts --network ${network.name}`
    );
  }

  const deployment = JSON.parse(
    fs.readFileSync(deploymentFile, "utf-8")
  ) as Deployment;

  const signers = await ethers.getSigners();
  const [admin, regulator, alice, bob] = signers;

  log({
    event: "demo_start",
    network: network.name,
    parties: { from: alice.address, to: bob.address },
  });

  // ─── Conecta nos contratos ─────────────────────────────────────────────────
  const token = await ethers.getContractAt(
    "PrivateToken",
    deployment.contracts.PrivateToken
  );
  const viewer = await ethers.getContractAt(
    "RegulatorViewer",
    deployment.contracts.RegulatorViewer
  );
  const dvp = await ethers.getContractAt(
    "DvPSettlement",
    deployment.contracts.DvPSettlement
  );

  // ─── Carrega fixture de prova (gerada off-chain) ───────────────────────────
  const fixture = loadValidFixture();
  const aliceCommitOld = uintToBytes32(fixture.inputs.commitAOld);
  const bobCommitOld = uintToBytes32(fixture.inputs.commitBOld);
  const aliceCommitNew = uintToBytes32(fixture.inputs.commitANew);
  const bobCommitNew = uintToBytes32(fixture.inputs.commitBNew);

  log({ event: "fixture_loaded", scenario: "T1_valid" });

  // ─── Mint inicial (idempotente — pula se ja' minted) ───────────────────────
  const ZERO = ethers.ZeroHash;
  const aliceCurrent = await token.commitments(alice.address);
  if (aliceCurrent === ZERO) {
    log({ event: "minting", account: alice.address });
    await (await token.connect(admin).mint(alice.address, aliceCommitOld)).wait();
  } else if (aliceCurrent !== aliceCommitOld) {
    throw new Error(
      `Alice tem commitment incompativel on-chain. Atual: ${aliceCurrent}, esperado: ${aliceCommitOld}. Resete a rede ou use outras contas.`
    );
  }

  const bobCurrent = await token.commitments(bob.address);
  if (bobCurrent === ZERO) {
    log({ event: "minting", account: bob.address });
    await (await token.connect(admin).mint(bob.address, bobCommitOld)).wait();
  } else if (bobCurrent !== bobCommitOld) {
    throw new Error(
      `Bob tem commitment incompativel on-chain. Atual: ${bobCurrent}, esperado: ${bobCommitOld}.`
    );
  }

  // ─── Cifra payload para regulador (mock ECIES) ─────────────────────────────
  const ciphertext = mockCiphertext(`demo-${Date.now()}`);
  log({ event: "ciphertext_prepared", bytes: (ciphertext.length - 2) / 2 });

  // ─── Executa DvP ───────────────────────────────────────────────────────────
  log({ event: "dvp_submitting" });
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

  if (!receipt) throw new Error("Transacao sem receipt");

  log({
    event: "dvp_mined",
    txHash: tx.hash,
    blockNumber: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
  });

  // ─── Verifica state changes ────────────────────────────────────────────────
  const aliceFinal = await token.commitments(alice.address);
  const bobFinal = await token.commitments(bob.address);
  const txCount = await viewer.txCount();
  const lastTxId = txCount - 1n;

  if (aliceFinal !== aliceCommitNew) {
    throw new Error(
      `Commit final de Alice incorreto. Esperado: ${aliceCommitNew}, atual: ${aliceFinal}`
    );
  }
  if (bobFinal !== bobCommitNew) {
    throw new Error(
      `Commit final de Bob incorreto. Esperado: ${bobCommitNew}, atual: ${bobFinal}`
    );
  }

  log({
    event: "state_verified",
    commitmentsUpdated: true,
    txCount: txCount.toString(),
  });

  // ─── Regulador recupera audit trail ────────────────────────────────────────
  const auditRecord = await viewer.connect(regulator).getEncryptedTx(lastTxId);
  log({
    event: "regulator_retrieved_audit",
    txId: lastTxId.toString(),
    from: auditRecord.from,
    to: auditRecord.to,
    blockNumber: auditRecord.blockNumber.toString(),
    ciphertextBytes: (auditRecord.ciphertext.length - 2) / 2,
    note: "ciphertext nao impresso — decifra off-chain pelo regulador",
  });

  // ─── Resumo final ──────────────────────────────────────────────────────────
  log({
    event: "demo_complete",
    network: network.name,
    summary: {
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(),
      txId: lastTxId.toString(),
      parties: { from: alice.address, to: bob.address },
      commitmentsBefore: { from: aliceCommitOld, to: bobCommitOld },
      commitmentsAfter: { from: aliceCommitNew, to: bobCommitNew },
    },
    privacy_invariant:
      "nenhum saldo ou valor transferido aparece em log/event/calldata",
  });
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log({ event: "demo_failed", error: message });
  process.exitCode = 1;
});
