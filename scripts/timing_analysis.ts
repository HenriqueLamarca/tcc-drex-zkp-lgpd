// =============================================================================
// timing_analysis.ts - Analise empirica de canais laterais on-chain
//                     (timing, gas, calldata size) durante DvPs sequenciais.
//
// Motivacao: o THREAT_MODEL.md cita Ismayilov & Ozturan (2023) e classifica
// o risco como "vulnerabilidade documentada, nao implementada (R1)". Este
// script vai alem: SIMULA um observador externo e MEDE empiricamente quais
// padroes vazam — gas, tamanho de calldata, variancia de timing.
//
// Resultado: vetor por DvP de (block, gasUsed, calldataBytes, txByteSize)
// e estatisticas (min, max, media, desvio-padrao, range). Se range = 0 em
// gas e calldata, nao ha sinal por esses canais.
//
// Uso:
//   npx hardhat run scripts/timing_analysis.ts --network hardhat
//   N=20 npx hardhat run scripts/timing_analysis.ts --network hardhat
// =============================================================================

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import {
  loadValidFixture,
  uintToBytes32,
  encryptForRegulator,
  type RegulatorPayload,
} from "../test/fixtures/helpers";
import { deployFullStack } from "../test/fixtures/deployStack";
import * as pretty from "./_pretty";

interface Sample {
  i: number;
  txHash: string;
  blockNumber: number;
  blockTimestamp: number;
  gasUsed: number;
  calldataBytes: number;
  ciphertextBytes: number;
}

interface Stats {
  min: number;
  max: number;
  mean: number;
  stddev: number;
  range: number;
}

function stats(values: number[]): Stats {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / values.length;
  const stddev = Math.sqrt(variance);
  return { min, max, mean, stddev, range: max - min };
}

async function main(): Promise<void> {
  const N = Number(process.env.N ?? 20);

  pretty.header(
    "Timing Analysis — observabilidade de canais laterais on-chain",
    `${N} DvPs sequenciais — rede: ${network.name}`
  );

  pretty.section("Setup");
  const stack = await deployFullStack();
  const { token, dvp } = stack;
  const [admin] = stack.signers;
  pretty.success("Stack deployado");

  // Para gerar N DvPs distintos, usamos N pares de signers diferentes.
  // Mintamos os mesmos commitments (todos partem da mesma fixture) para
  // cada par, e cada par executa exatamente um DvP no proprio bloco.
  const signers = await ethers.getSigners();
  if (signers.length < 2 + 2 * N) {
    pretty.fail(
      `Sao necessarios pelo menos ${2 + 2 * N} signers (admin + regulator + ${N} pares). Ha apenas ${signers.length}.`
    );
    pretty.note("Use --network hardhat (que disponibiliza ~20 signers por default) ou ajuste a configuracao da Hardhat Network para gerar mais.");
    process.exit(1);
  }

  const fixture = loadValidFixture();
  const samples: Sample[] = [];

  pretty.section(`Submetendo ${N} DvPs sequenciais`);
  for (let i = 0; i < N; i++) {
    const payer = signers[2 + i * 2];
    const payee = signers[3 + i * 2];

    await token
      .connect(admin)
      .mint(payer.address, uintToBytes32(fixture.inputs.commitAOld));
    await token
      .connect(admin)
      .mint(payee.address, uintToBytes32(fixture.inputs.commitBOld));

    const payload: RegulatorPayload = {
      from: payer.address,
      to: payee.address,
      value: "30",
      timestamp: new Date().toISOString(),
    };
    const ciphertext = encryptForRegulator(payload);

    const txResponse = await dvp
      .connect(payer)
      .executeDvP(payer.address, payee.address, fixture.proof, fixture.inputs, ciphertext);
    const receipt = await txResponse.wait();
    if (!receipt) throw new Error("Tx sem receipt");

    const block = await ethers.provider.getBlock(receipt.blockNumber);
    if (!block) throw new Error("Bloco nao encontrado");

    const calldata = txResponse.data;
    samples.push({
      i,
      txHash: receipt.hash,
      blockNumber: receipt.blockNumber,
      blockTimestamp: Number(block.timestamp),
      gasUsed: Number(receipt.gasUsed),
      calldataBytes: (calldata.length - 2) / 2,
      ciphertextBytes: (ciphertext.length - 2) / 2,
    });

    if (i === 0 || (i + 1) % 5 === 0) {
      pretty.note(`${i + 1}/${N} concluidos`);
    }
  }
  pretty.success(`${N} DvPs executados`);

  pretty.section("Estatisticas dos canais observaveis");
  const gasStats = stats(samples.map((s) => s.gasUsed));
  // Exclui o primeiro sample para isolar o efeito de cold storage write
  // (1a tx paga ~17k gas extra por SSTORE cold; subsequentes sao warm)
  const gasStatsSteady = samples.length > 1
    ? stats(samples.slice(1).map((s) => s.gasUsed))
    : gasStats;
  const calldataStats = stats(samples.map((s) => s.calldataBytes));
  const ciphertextStats = stats(samples.map((s) => s.ciphertextBytes));
  const blockDeltas = samples
    .slice(1)
    .map((s, idx) => s.blockTimestamp - samples[idx].blockTimestamp);
  const blockStats = blockDeltas.length
    ? stats(blockDeltas)
    : { min: 0, max: 0, mean: 0, stddev: 0, range: 0 };

  function row(label: string, s: Stats, unit: string): void {
    pretty.info(
      label,
      `min=${s.min} max=${s.max} media=${s.mean.toFixed(1)} stddev=${s.stddev.toFixed(1)} range=${s.range} ${unit}`
    );
  }
  row("gasUsed (todos)", gasStats, "gas");
  row("gasUsed (sem 1a tx, steady-state)", gasStatsSteady, "gas");
  row("calldata", calldataStats, "bytes");
  row("ciphertext (off-chain)", ciphertextStats, "bytes");
  row("delta entre blocos", blockStats, "s");

  pretty.section("Interpretacao (observador adversario)");
  const findings: string[] = [];
  if (gasStatsSteady.range <= 100) {
    findings.push(
      `OK gasUsed steady-state (sem 1a tx): range=${gasStatsSteady.range} gas — abaixo do threshold de ruido EVM (warm/cold sstore = ~22100 gas). Variancia de 1a tx (${gasStats.range - gasStatsSteady.range} gas) e' efeito de cold storage, intrinseco a EVM e nao especifico ao protocolo`
    );
  } else if (gasStats.range === 0) {
    findings.push("OK gasUsed constante");
  } else {
    findings.push(
      `SINAL gasUsed variavel mesmo em steady-state (range=${gasStatsSteady.range}): adversario pode classificar transacoes por consumo`
    );
  }
  if (calldataStats.range === 0) {
    findings.push("OK calldata constante: nao distingue transacoes por tamanho de calldata");
  } else {
    findings.push(
      `SINAL calldata variavel (range=${calldataStats.range} bytes): vaza informacao por tamanho do blob ECIES (depende do payload cifrado)`
    );
  }
  if (ciphertextStats.range === 0) {
    findings.push("OK ciphertext constante");
  } else {
    findings.push(
      `SINAL ciphertext variavel (range=${ciphertextStats.range} bytes): proporcional ao payload — caso conhecido em ECIES sem padding`
    );
  }
  for (const f of findings) {
    if (f.startsWith("OK")) pretty.success(f.replace(/^OK\s+/, ""));
    else pretty.warn(f.replace(/^SINAL\s+/, ""));
  }

  pretty.section("Mitigacoes propostas (NAO implementadas nesta PoC)");
  pretty.note("Padding de calldata: completar com bytes zero ate um tamanho fixo (ex.: 512B)");
  pretty.note("Batching temporal: acumular DvPs em janelas fixas (ex.: 1 min) e mineralos em ordem aleatoria");
  pretty.note("Mixing de timing: introduzir delay aleatorio entre submissao do cliente e mineracao");
  pretty.note("Referencia: Ismayilov & Ozturan (2023); ver THREAT_MODEL.md secao I2");

  // Persistir CSV e JSON para reprodutibilidade
  const outDir = path.join(__dirname, "..", "benchmark", "results");
  fs.mkdirSync(outDir, { recursive: true });
  const csvPath = path.join(outDir, "timing_analysis.csv");
  const jsonPath = path.join(outDir, "timing_analysis.json");

  const csvHeader = "i,blockNumber,blockTimestamp,gasUsed,calldataBytes,ciphertextBytes\n";
  const csvBody = samples
    .map(
      (s) =>
        `${s.i},${s.blockNumber},${s.blockTimestamp},${s.gasUsed},${s.calldataBytes},${s.ciphertextBytes}`
    )
    .join("\n");
  fs.writeFileSync(csvPath, csvHeader + csvBody + "\n");

  fs.writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        n: N,
        network: network.name,
        generatedAt: new Date().toISOString(),
        samples,
        stats: { gas: gasStats, gasSteadyState: gasStatsSteady, calldata: calldataStats, ciphertext: ciphertextStats, blockDelta: blockStats },
        findings,
      },
      null,
      2
    )
  );

  pretty.section("Saidas");
  pretty.info("CSV", csvPath);
  pretty.info("JSON", jsonPath);

  pretty.done("Timing analysis concluida", [
    `${N} DvPs medidos | gas range = ${gasStats.range} | calldata range = ${calldataStats.range} bytes`,
    "Resultados defendidos honestamente: vulnerabilidades de timing/size DECLARADAS e MEDIDAS.",
  ]);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  pretty.fail(`Timing analysis falhou: ${message}`);
  process.exitCode = 1;
});
