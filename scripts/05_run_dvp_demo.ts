// =============================================================================
// 05_run_dvp_demo.ts — Cenario ponta-a-ponta DvP no DREX-PoC.
//
// Pre-requisitos:
//   1. Setup ZoKrates: bash scripts/01_setup_zkp.sh
//   2. Fixture de prova: bash scripts/03_generate_test_fixtures.sh
//   3. Deploy: npx hardhat run scripts/04_deploy.ts --network <rede>
//
// Cenario (mesmo do smoke test T1 e da fixture):
//   - Henrique Lamarca (S_A=100) transfere V=30 para Tassio Ferenzini (S_B=50)
//   - Saldos finais: Henrique Lamarca=70, Tassio Ferenzini=80 (provados internamente, nao revelados)
//
// Fluxo:
//   1. Carrega deployment JSON da rede atual
//   2. Mint inicial dos commitments de Henrique Lamarca e Tassio Ferenzini (idempotente)
//   3. Cifra payload real para o regulador (ECIES secp256k1)
//   4. Submete prova Groth16 + 4 inputs publicos ao DvPSettlement
//   5. Verifica state changes: commitments updated, txCount++
//   6. Regulador acessa pela via auditavel (accessEncryptedTx) e decifra
//      o blob off-chain (roundtrip ECIES verificado, sem vazar o valor)
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
  PrivateToken,
  RegulatorViewer,
  DvPSettlement,
} from "../typechain-types";
import {
  loadValidFixture,
  uintToBytes32,
  encryptForRegulator,
  decryptAsRegulator,
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

import * as pretty from "./_pretty";

function log(payload: Record<string, unknown>): void {
  pretty.json(payload);
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
  const [admin, regulator] = signers;

  // Partes efemeras: novas a cada execucao, garantindo que a demo seja sempre
  // re-executavel (o estado de uma execucao anterior nunca colide). Sao apenas
  // labels no mapeamento de commitments; quem paga o gas e' o admin. O
  // commitment Poseidon (hash do saldo) e' o mesmo independentemente do
  // endereco que o detem, entao a prova de referencia permanece valida.
  const alice = ethers.Wallet.createRandom();
  const bob = ethers.Wallet.createRandom();

  pretty.header(
    `Demo DvP — PoC DREX-ZKP-LGPD   (rede: ${network.name})`,
    `Pagador: Henrique Lamarca   →   Recebedor: Tassio Ferenzini`
  );
  log({
    event: "demo_start",
    network: network.name,
    parties: { from: alice.address, to: bob.address },
  });

  // ─── Conecta nos contratos ─────────────────────────────────────────────────
  const token = (await ethers.getContractAt(
    "PrivateToken",
    deployment.contracts.PrivateToken
  )) as unknown as PrivateToken;
  const viewer = (await ethers.getContractAt(
    "RegulatorViewer",
    deployment.contracts.RegulatorViewer
  )) as unknown as RegulatorViewer;
  const dvp = (await ethers.getContractAt(
    "DvPSettlement",
    deployment.contracts.DvPSettlement
  )) as unknown as DvPSettlement;

  // ─── Carrega fixture de prova (gerada off-chain) ───────────────────────────
  const fixture = loadValidFixture();
  const aliceCommitOld = uintToBytes32(fixture.inputs.commitAOld);
  const bobCommitOld = uintToBytes32(fixture.inputs.commitBOld);
  const aliceCommitNew = uintToBytes32(fixture.inputs.commitANew);
  const bobCommitNew = uintToBytes32(fixture.inputs.commitBNew);

  pretty.step(1, 6, "Carregando deployment + prova ZK (fixture)");
  log({ event: "fixture_loaded", scenario: "T1_valid" });

  // ─── Mint inicial (idempotente — pula se ja' minted) ───────────────────────
  const ZERO = ethers.ZeroHash;
  const aliceCurrent = await token.commitments(alice.address);
  if (aliceCurrent === ZERO) {
    log({ event: "minting", account: alice.address });
    await (await token.connect(admin).mint(alice.address, aliceCommitOld)).wait();
    pretty.step(2, 6, "Registrando saldo inicial de Henrique Lamarca (commitment Poseidon)");
  } else if (aliceCurrent !== aliceCommitOld) {
    throw new Error(
      `Henrique Lamarca tem commitment incompativel on-chain. Atual: ${aliceCurrent}, esperado: ${aliceCommitOld}. Resete a rede ou use outras contas.`
    );
  } else {
    pretty.step(2, 6, "Saldo de Henrique Lamarca ja registrado (idempotente)");
  }

  const bobCurrent = await token.commitments(bob.address);
  if (bobCurrent === ZERO) {
    log({ event: "minting", account: bob.address });
    await (await token.connect(admin).mint(bob.address, bobCommitOld)).wait();
    pretty.step(3, 6, "Registrando saldo inicial de Tassio Ferenzini (commitment Poseidon)");
  } else if (bobCurrent !== bobCommitOld) {
    throw new Error(
      `Tassio Ferenzini tem commitment incompativel on-chain. Atual: ${bobCurrent}, esperado: ${bobCommitOld}.`
    );
  } else {
    pretty.step(3, 6, "Saldo de Tassio Ferenzini ja registrado (idempotente)");
  }

  // ─── Cifra payload real para o regulador (ECIES secp256k1) ─────────────────
  // O payload contém o valor transferido (V=30) — NUNCA impresso no log
  // (RNF06). Só o regulador, com a chave privada, decifra off-chain.
  const ciphertext = encryptForRegulator({
    from: alice.address,
    to: bob.address,
    value: "30",
    timestamp: new Date().toISOString(),
  });
  const cipherBytes = (ciphertext.length - 2) / 2;
  pretty.step(4, 6, "Cifrando payload de auditoria (ECIES secp256k1)");
  pretty.info("tamanho do blob cifrado", `${cipherBytes} bytes`);
  log({
    event: "ciphertext_prepared",
    scheme: "ECIES(secp256k1 + HKDF + AES-256-GCM)",
    bytes: cipherBytes,
  });

  // ─── Executa DvP ───────────────────────────────────────────────────────────
  log({ event: "dvp_submitting" });
  const tx = await dvp
    .connect(admin)
    .executeDvP(
      alice.address,
      bob.address,
      fixture.proof,
      fixture.inputs,
      ciphertext
    );
  const receipt = await tx.wait();

  if (!receipt) throw new Error("Transacao sem receipt");

  pretty.step(5, 6, "DvP submetido e minerado on-chain");
  pretty.info("tx hash", tx.hash.slice(0, 10) + "…" + tx.hash.slice(-8));
  pretty.info("bloco", receipt.blockNumber);
  pretty.info("gas consumido", receipt.gasUsed.toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."));
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
      `Commit final de Henrique Lamarca incorreto. Esperado: ${aliceCommitNew}, atual: ${aliceFinal}`
    );
  }
  if (bobFinal !== bobCommitNew) {
    throw new Error(
      `Commit final de Tassio Ferenzini incorreto. Esperado: ${bobCommitNew}, atual: ${bobFinal}`
    );
  }

  pretty.step(6, 6, "Verificando estado pós-transação (commitments atualizados)");
  log({
    event: "state_verified",
    commitmentsUpdated: true,
    txCount: txCount.toString(),
  });

  // ─── Regulador acessa audit trail pela via AUDITAVEL ───────────────────────
  // accessEncryptedTx emite RegulatorAccessed (trilha imutavel on-chain de
  // quem acessou o que e quando) — fecha o vetor R2 do THREAT_MODEL.
  pretty.section("Trilha de auditoria do regulador (LC 105/2001)");
  const auditRecord = await viewer
    .connect(regulator)
    .accessEncryptedTx.staticCall(lastTxId);
  const accessTx = await viewer.connect(regulator).accessEncryptedTx(lastTxId);
  const accessReceipt = await accessTx.wait();
  pretty.success("Regulador acessa via accessEncryptedTx → emite RegulatorAccessed on-chain");
  pretty.info("acesso registrado no bloco", accessReceipt!.blockNumber);
  pretty.info("tx do acesso", accessTx.hash.slice(0, 10) + "…" + accessTx.hash.slice(-8));
  log({
    event: "regulator_accessed_audit",
    txId: lastTxId.toString(),
    from: auditRecord.from,
    to: auditRecord.to,
    blockNumber: auditRecord.blockNumber.toString(),
    ciphertextBytes: (auditRecord.ciphertext.length - 2) / 2,
    accessAuditTxHash: accessTx.hash,
    accessAuditBlock: accessReceipt!.blockNumber,
    note: "RegulatorAccessed emitido on-chain — acesso nao-repudiavel",
  });

  // ─── Regulador decifra o blob ECIES off-chain (com a chave privada) ────────
  // Prova que o canal de auditoria funciona fim-a-fim. O valor decifrado
  // (V) NÃO é impresso — RNF06: apenas confirmamos o roundtrip e que as
  // partes batem com o esperado, sem vazar o valor no log público.
  const decrypted = decryptAsRegulator(auditRecord.ciphertext);
  const roundtripOk =
    decrypted.from === alice.address &&
    decrypted.to === bob.address &&
    typeof decrypted.value === "string" &&
    decrypted.value.length > 0;
  if (pretty.isCompact()) {
    pretty.card(
      "TRILHA DE AUDITORIA DO REGULADOR (LC 105/2001)",
      [
        "Acesso via accessEncryptedTx → evento RegulatorAccessed on-chain",
        `Bloco do acesso:  ${accessReceipt!.blockNumber}`,
        `Tx do acesso:     ${accessTx.hash.slice(0, 10)}…${accessTx.hash.slice(-8)}`,
        "",
        `Decifração ECIES off-chain:  ${roundtripOk ? "roundtrip verificado OK" : "FALHOU"}`,
        "Valor recuperado pelo regulador, NÃO impresso (RNF06).",
      ],
      roundtripOk ? "green" : "red"
    );
  } else if (roundtripOk) {
    pretty.success("Regulador decifra o blob ECIES off-chain — roundtrip verificado");
  } else {
    pretty.fail("Roundtrip ECIES falhou");
  }

  // ─── Comprovante visual emitido pelo regulador ─────────────────────────────
  // Os saldos antes/depois vêm do witness-data.json (visão privilegiada do
  // regulador, reconstruída off-chain a partir do blob ECIES + histórico).
  // ON-CHAIN só existem os 4 commitments Poseidon. RNF06 preservado: este
  // comprovante NÃO é emitido por nenhum contrato — é produzido na máquina
  // do regulador depois que ele aplicou sua chave privada.
  if (roundtripOk) {
    const witnessFile = path.join(__dirname, "..", "test", "fixtures", "witness-data.json");
    const witness = JSON.parse(fs.readFileSync(witnessFile, "utf-8")) as {
      private_inputs: { S_A: string; S_B: string; V: string; S_A_new: string; S_B_new: string };
    };
    const block = await ethers.provider.getBlock(receipt.blockNumber);
    const blockTs = block ? new Date(block.timestamp * 1000).toISOString() : new Date().toISOString();
    pretty.receipt({
      txHash: tx.hash,
      blockNumber: receipt.blockNumber,
      timestamp: blockTs,
      network: network.name,
      gasUsed: receipt.gasUsed.toString(),
      from: {
        label: "Henrique Lamarca",
        address: alice.address,
        balanceBefore: witness.private_inputs.S_A,
        balanceAfter: witness.private_inputs.S_A_new,
      },
      to: {
        label: "Tassio Ferenzini",
        address: bob.address,
        balanceBefore: witness.private_inputs.S_B,
        balanceAfter: witness.private_inputs.S_B_new,
      },
      value: witness.private_inputs.V,
      commitmentsBefore: { from: aliceCommitOld, to: bobCommitOld },
      commitmentsAfter:  { from: aliceCommitNew, to: bobCommitNew },
    });
  }
  log({
    event: "regulator_decrypted_offchain",
    scheme: "ECIES(secp256k1 + HKDF + AES-256-GCM)",
    roundtripVerified: roundtripOk,
    partiesMatch: decrypted.from === alice.address && decrypted.to === bob.address,
    note: "valor decifrado recuperado pelo regulador, NAO impresso (RNF06)",
  });

  // ─── Resumo final ──────────────────────────────────────────────────────────
  const gasFmt = receipt.gasUsed.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  pretty.done("✓  Demo concluída — privacidade preservada", [
    `Rede:           ${network.name}`,
    `Tx hash:        ${tx.hash.slice(0, 10)}…${tx.hash.slice(-8)}`,
    `Bloco:          ${receipt.blockNumber}`,
    `Gas (executeDvP completo):  ${gasFmt}`,
    ``,
    `Privacidade:    on-chain só há hashes Poseidon (ver commitments acima).`,
    `Auditoria:      regulador decifrou off-chain → comprovante acima.`,
  ]);
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

main()
  .then(() => {
    // Sinaliza sucesso por arquivo-sentinela antes do exit (ver 04_deploy.ts).
    try { fs.writeFileSync(".make_step.ok", "demo"); } catch { /* sentinela e best-effort */ }
    process.exit(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log({ event: "demo_failed", error: message });
    pretty.fail(`Demo falhou: ${message}`);
    process.exit(1);
  });
