// =============================================================================
// show_onchain.ts - "O que a rede enxerga on-chain".
//
// Le o estado PUBLICO dos contratos (sem nenhuma chave privilegiada) e evidencia
// que, na cadeia, NAO ha saldos nem valores em claro: apenas commitments
// Poseidon (hashes de mao unica) e blobs de auditoria cifrados (ECIES). E' a
// demonstracao direta de privacidade (RF03) + auditabilidade seletiva (RF05)
// para a defesa/banca.
//
// Le os enderecos FIXOS do livro-razao interativo (modo DVP_STATEFUL do
// 05_run_dvp_demo.ts): Henrique (...0b01) e Tassio (...0b02). Rode apos uma
// liquidacao interativa para ver os commitments populados.
//
// Uso:  npx hardhat run scripts/show_onchain.ts --network besu
// =============================================================================

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import { PrivateToken, RegulatorViewer } from "../typechain-types";
import * as pretty from "./_pretty";
import { shutdown } from "./_shutdown";

const ZERO = ethers.ZeroHash;

// Mesmos enderecos fixos do modo stateful (scripts/05_run_dvp_demo.ts).
const HENRIQUE = new ethers.Wallet(
  "0x0000000000000000000000000000000000000000000000000000000000000b01"
).address;
const TASSIO = new ethers.Wallet(
  "0x0000000000000000000000000000000000000000000000000000000000000b02"
).address;

function shortHash(h: string): string {
  if (!h || h === ZERO) return "(vazio - sem commitment ainda)";
  return h.slice(0, 18) + "..." + h.slice(-8);
}
function shortAddr(a: string): string {
  return a.slice(0, 10) + "..." + a.slice(-6);
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
      `Deployment nao encontrado para a rede ${network.name}. Rode o deploy primeiro (make viz:up faz isso).`
    );
  }
  const deployment = JSON.parse(fs.readFileSync(deploymentFile, "utf-8")) as {
    contracts: { PrivateToken: string; RegulatorViewer: string };
  };

  const token = (await ethers.getContractAt(
    "PrivateToken",
    deployment.contracts.PrivateToken
  )) as unknown as PrivateToken;
  const viewer = (await ethers.getContractAt(
    "RegulatorViewer",
    deployment.contracts.RegulatorViewer
  )) as unknown as RegulatorViewer;

  pretty.header(
    "O que a rede enxerga on-chain",
    `Inspecao do estado publico - rede: ${network.name}`
  );

  // ─── Leitura publica: commitments (hashes) e contador da trilha cifrada ──────
  const cH = await token.commitments(HENRIQUE);
  const cT = await token.commitments(TASSIO);
  const n = await viewer.txCount();

  const lines: string[] = [
    "Na cadeia NAO existe 'saldo' em claro. Para cada conta ha apenas um",
    "COMMITMENT Poseidon = hash de mao unica de (saldo, segredo). Qualquer",
    "no da rede consulta isto - e nada mais:",
    "",
    `  Henrique Lamarca  (${shortAddr(HENRIQUE)})`,
    `     commitment: ${shortHash(cH)}`,
    `  Tassio Ferenzini  (${shortAddr(TASSIO)})`,
    `     commitment: ${shortHash(cT)}`,
    "",
    `Trilha de auditoria (RegulatorViewer): ${n.toString()} liquidacao(oes).`,
  ];

  if (n > 0n) {
    const [mFrom, mTo, mBlock] = await viewer.getTxMetadata(n - 1n);
    lines.push(
      "  Ultimo registro - metadados PUBLICOS (partes e bloco):",
      `     de:    ${shortAddr(mFrom)}`,
      `     para:  ${shortAddr(mTo)}`,
      `     bloco: ${mBlock.toString()}`,
      "     valor: CIFRADO (ECIES) - ilegivel sem a chave do regulador"
    );
  } else {
    lines.push("  (rode uma liquidacao interativa para popular os commitments)");
  }

  lines.push(
    "",
    "Conclusao: nem saldo, nem valor transferido, nem dado pessoal",
    "aparecem em claro on-chain. So o regulador (LC 105/2001), com sua",
    "chave privada, decifra o conteudo - auditabilidade SELETIVA."
  );

  pretty.card(
    "ESTADO ON-CHAIN - visivel a QUALQUER participante da rede",
    lines,
    "cyan"
  );

  pretty.json({
    event: "onchain_inspect",
    network: network.name,
    commitments: { henrique: cH, tassio: cT },
    auditTrailCount: n.toString(),
    privacy_invariant: "on-chain so' ha' hashes Poseidon + blobs cifrados",
  });

  pretty.done("✓  Inspecao on-chain concluida", [
    "Privacidade (RF03): saldos e valores nunca aparecem em claro.",
    "Auditabilidade (RF05): so o regulador decifra, e o acesso fica logado.",
  ]);
}

main()
  .then(() => {
    try {
      fs.writeFileSync(".make_step.ok", "onchain");
    } catch {
      /* sentinela e best-effort */
    }
    shutdown(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    pretty.fail(`Inspecao on-chain falhou: ${message}`);
    shutdown(1);
  });
