// =============================================================================
// 06_run_dvp_demo_fail.ts - Cenario de REJEICAO de uma liquidacao invalida.
//
// Complementa o 05 (caminho feliz) demonstrando, para a banca, que a rede
// REJEITA uma tentativa de liquidacao que nao apresenta uma prova de solvencia
// valida. E' o caso, por exemplo, de um pagador sem saldo: como o circuito se
// recusa a gerar a prova de uma transferencia insolvente (ver `make zkp:test`),
// qualquer submissao a rede usa dados que NAO conferem com a prova. O
// DvPSettlement entao reverte com InvalidProof.
//
// Para ser deterministica e nao interferir com a demo de sucesso, esta demo
// usa enderecos de teste dedicados (apenas labels no mapeamento de commitments;
// quem paga o gas e' o admin). Como toda execucao reverte, o estado desses
// enderecos permanece estavel entre execucoes.
//
// Uso:
//   npx hardhat run scripts/06_run_dvp_demo_fail.ts --network besu
//   npx hardhat run scripts/06_run_dvp_demo_fail.ts --network localhost
// =============================================================================

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { PrivateToken, DvPSettlement } from "../typechain-types";
import { loadValidFixture, uintToBytes32, encryptForRegulator } from "../test/fixtures/helpers";
import * as pretty from "./_pretty";
import { shutdown } from "./_shutdown";

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
  pretty.json(payload);
}

function short(addr: string): string {
  return addr.slice(0, 6) + "..." + addr.slice(-4);
}

function shHash(h: string): string {
  return h.slice(0, 12) + "..." + h.slice(-6);
}

// Rotulos das partes (mesmos nomes da demo de sucesso, para consistencia).
const FROM_LABEL = "Henrique Lamarca";
const TO_LABEL = "Tassio Ferenzini";

// Enderecos de teste dedicados a esta demo (chaves de teste; nunca assinam,
// servem so como labels no mapeamento de commitments).
const PARTY_FROM = new ethers.Wallet(
  "0x0000000000000000000000000000000000000000000000000000000000000a11"
).address;
const PARTY_TO = new ethers.Wallet(
  "0x0000000000000000000000000000000000000000000000000000000000000a12"
).address;

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

  const [admin] = await ethers.getSigners();

  pretty.header(
    `Demo de REJEICAO - PoC DREX-ZKP-LGPD   (rede: ${network.name})`,
    `Tentativa: ${FROM_LABEL} -> ${TO_LABEL} (prova de solvencia invalida)`
  );
  log({ event: "demo_fail_start", network: network.name });

  const token = (await ethers.getContractAt(
    "PrivateToken",
    deployment.contracts.PrivateToken
  )) as unknown as PrivateToken;
  const dvp = (await ethers.getContractAt(
    "DvPSettlement",
    deployment.contracts.DvPSettlement
  )) as unknown as DvPSettlement;

  const fixture = loadValidFixture();
  const commitAOld = uintToBytes32(fixture.inputs.commitAOld);
  const commitBOld = uintToBytes32(fixture.inputs.commitBOld);
  const commitBNewExpected = uintToBytes32(fixture.inputs.commitBNew);

  pretty.step(1, 4, "Carregando deployment + prova ZK de referencia");
  pretty.note(`Pagador:   ${FROM_LABEL} (${short(PARTY_FROM)})`);
  pretty.note(`Recebedor: ${TO_LABEL} (${short(PARTY_TO)})`);

  // ─── Registra o estado inicial dos enderecos de teste (idempotente) ────────
  const ZERO = ethers.ZeroHash;
  const fromCur = await token.commitments(PARTY_FROM);
  if (fromCur === ZERO) {
    await (await token.connect(admin).mint(PARTY_FROM, commitAOld)).wait();
  }
  const toCur = await token.commitments(PARTY_TO);
  if (toCur === ZERO) {
    await (await token.connect(admin).mint(PARTY_TO, commitBOld)).wait();
  }
  pretty.step(2, 4, "Estado inicial dos commitments registrado");

  // ─── Monta uma submissao INVALIDA ──────────────────────────────────────────
  // Os commitments antigos batem com o estado on-chain (passam na checagem de
  // consistencia), mas o commitment final declarado e' adulterado: nao
  // corresponde a' prova. E' o que aconteceria com uma transferencia insolvente
  // forcada a' rede - a prova de solvencia nao confere com os dados.
  const tamperedInputs = {
    commitAOld: fixture.inputs.commitAOld,
    commitBOld: fixture.inputs.commitBOld,
    commitANew: fixture.inputs.commitANew,
    commitBNew: fixture.inputs.commitBNew + 1n, // <- adulterado
  };
  const commitBNewDeclared = uintToBytes32(tamperedInputs.commitBNew);
  const ciphertext = encryptForRegulator({
    from: PARTY_FROM,
    to: PARTY_TO,
    value: "150",
    timestamp: new Date().toISOString(),
  });
  pretty.step(3, 4, "Submetendo liquidacao com prova que NAO confere com os dados");
  pretty.info("Operacao tentada", `${FROM_LABEL} -> ${TO_LABEL}`);
  pretty.info("Commit. antigos (conferem com a cadeia)", `${shHash(commitAOld)} / ${shHash(commitBOld)}`);
  pretty.info("Commit. recebedor exigido pela prova", shHash(commitBNewExpected));
  pretty.info("Commit. recebedor declarado (adulterado)", shHash(commitBNewDeclared));
  pretty.note(
    "O commitment final declarado nao corresponde a' prova: a verificacao on-chain (Verifier) falha e a liquidacao reverte."
  );
  log({ event: "submitting_invalid_dvp", reason: "commitBNew adulterado" });

  // ─── Tenta executar - esperamos REVERT ─────────────────────────────────────
  let rejected = false;
  let reason = "";
  try {
    const tx = await dvp
      .connect(admin)
      .executeDvP(PARTY_FROM, PARTY_TO, fixture.proof, tamperedInputs, ciphertext);
    await tx.wait();
  } catch (err: unknown) {
    rejected = true;
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("InvalidProof")) reason = "InvalidProof";
    else if (msg.includes("CommitmentMismatch")) reason = "CommitmentMismatch";
    else reason = "revert";
  }

  pretty.step(4, 4, "Verificando o resultado da rede", rejected);

  if (!rejected) {
    pretty.fail(
      "INESPERADO: a rede ACEITOU uma liquidacao invalida. Isso indicaria falha de seguranca."
    );
    log({ event: "demo_fail_unexpected_accept" });
    throw new Error("Liquidacao invalida foi aceita - verifique o Verifier/contratos");
  }

  // Estado nao mudou - confirma que a rejeicao foi atomica
  const fromAfter = await token.commitments(PARTY_FROM);
  const stateUnchanged = fromAfter === commitAOld;

  if (pretty.isCompact()) {
    pretty.card(
      "COMPROVANTE - LIQUIDAÇÃO REJEITADA (prova inválida)",
      [
        `Operação tentada:  ${FROM_LABEL} -> ${TO_LABEL}`,
        "",
        "Commitments antigos (conferem com a cadeia, passam na 1ª checagem):",
        `  ${FROM_LABEL}:  ${shHash(commitAOld)}`,
        `  ${TO_LABEL}:  ${shHash(commitBOld)}`,
        "",
        "Commitment final do recebedor - é onde a fraude aparece:",
        `  exigido pela prova:      ${shHash(commitBNewExpected)}`,
        `  declarado (adulterado):  ${shHash(commitBNewDeclared)}  <- não bate`,
        "",
        `Verifier rejeita (${reason}) - a liquidação reverte (atômica).`,
        `Estado on-chain inalterado${stateUnchanged ? " (OK)" : " (ATENÇÃO)"}.`,
        "A rede só liquida operações com prova de solvência válida.",
      ],
      "red"
    );
  } else {
    pretty.section("Resultado: liquidacao corretamente REJEITADA");
    pretty.success(
      `A rede reverteu a transacao (${reason}) - a prova de solvencia nao confere com os dados.`
    );
    pretty.success(
      `Estado inalterado: o commitment do pagador permanece o original (${stateUnchanged ? "confirmado" : "ATENCAO"}).`
    );
    pretty.note(
      "Em uma transferencia insolvente, o circuito sequer geraria a prova (ver make zkp:test)."
    );
    pretty.done("✓  Controle de seguranca validado - operacao invalida bloqueada", [
      `Rede:            ${network.name}`,
      `Motivo da rejeicao:  ${reason}`,
      `Estado on-chain:     inalterado (rejeicao atomica)`,
      ``,
      `Conclusao: a rede so' liquida operacoes com prova de solvencia valida.`,
    ]);
  }
  log({
    event: "demo_fail_complete",
    rejected: true,
    reason,
    stateUnchanged,
  });
}

main()
  .then(() => {
    // Sentinela: a demo "teve sucesso" quando a operacao invalida foi rejeitada
    // como esperado. Saida limpa para evitar o crash de teardown do libuv.
    try { fs.writeFileSync(".make_step.ok", "demo_fail"); } catch { /* sentinela e best-effort */ }
    shutdown(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log({ event: "demo_fail_error", error: message });
    pretty.fail(`Demo de rejeicao falhou: ${message}`);
    shutdown(1);
  });
