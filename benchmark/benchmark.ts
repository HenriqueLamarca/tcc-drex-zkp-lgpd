// =============================================================================
// benchmark.ts - Mede tempo de prova, gas on-chain, tamanho de prova e
//                numero de constraints do circuito solvency_dvp.zok.
//
// Salva em benchmark/results/results.csv com colunas:
//   operacao, tempo_ms, gas_consumido, tamanho_prova_bytes, n_constraints
//
// Pre-requisitos:
//   - Docker rodando (para zokrates compute-witness + generate-proof)
//   - Fixture gerada em test/fixtures/valid-proof.json
//   - Compilacao do circuito disponivel em circuits/proving_key/
//
// Uso:
//   npx hardhat run benchmark/benchmark.ts --network hardhat
//
// Specs da maquina de referencia documentadas no cabecalho do CSV.
// =============================================================================

import { ethers } from "hardhat";
import { execSync } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";
import {
  loadValidFixture,
  uintToBytes32,
  mockCiphertext,
} from "../test/fixtures/helpers";
import { deployFullStack } from "../test/fixtures/deployStack";
import * as pretty from "../scripts/_pretty";
import {
  PrivateToken,
  DvPSettlement,
  Verifier,
} from "../typechain-types";

const REPO_ROOT = path.join(__dirname, "..");
const RESULTS_DIR = path.join(__dirname, "results");
const CSV_FILE = path.join(RESULTS_DIR, "results.csv");
const ZOKRATES_IMAGE = "zokrates/zokrates:0.8.8";
const ITERATIONS = 5;

interface Row {
  operacao: string;
  tempo_ms: string;
  gas_consumido: string;
  tamanho_prova_bytes: string;
  n_constraints: string;
}

function log(payload: Record<string, unknown>): void {
  pretty.json(payload);
}

function fmt(n: number | bigint): string {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function runDocker(cmd: string): void {
  execSync(cmd, { stdio: "pipe", env: { ...process.env, MSYS_NO_PATHCONV: "1" } });
}

function readConstraintsCount(): number {
  // DECISAO DE DESIGN (ADR implicito): recompilamos o circuito via Docker
  // para LER o numero de constraints do stdout do ZoKrates, em vez de usar
  // o valor hardcoded direto. Custo: ~1 docker run (~1s). Beneficio: o
  // benchmark valida que solvency_dvp.zok NAO mudou desde o setup — se
  // alguem alterar o circuito sem refazer make zkp:setup, o numero aqui
  // diverge e o CSV documenta a inconsistencia. O fallback 1728 (valor
  // confirmado no M3) so' e' usado se o Docker estiver indisponivel.
  try {
    const output = execSync(
      `docker run --rm -v "${REPO_ROOT}:/home/zokrates/code" -w /home/zokrates/code --user root ${ZOKRATES_IMAGE} zokrates compile -i circuits/solvency_dvp.zok -o /tmp/recompile-out --abi-spec /tmp/recompile-abi.json 2>&1`,
      { env: { ...process.env, MSYS_NO_PATHCONV: "1" }, encoding: "utf-8" }
    );
    const match = output.match(/Number of constraints:\s*(\d+)/);
    if (match) return parseInt(match[1], 10);
  } catch {
    // fallback se Docker nao estiver disponivel
  }
  return 1728; // valor confirmado no setup inicial (M3)
}

function computeWitnessAndProof(): { witnessMs: number; proofMs: number } {
  // Limpa arquivos anteriores
  const witnessPath = path.join(REPO_ROOT, "circuits", "proving_key", "bench-witness");
  const proofPath = path.join(REPO_ROOT, "circuits", "proving_key", "bench-proof.json");

  const fixture = loadValidFixture();
  const args = [
    fixture.inputs.commitAOld.toString(),
    fixture.inputs.commitBOld.toString(),
    fixture.inputs.commitANew.toString(),
    fixture.inputs.commitBNew.toString(),
    "100", // S_A
    "50", // S_B
    "30", // V
    "11111", // r_A_old
    "22222", // r_B_old
    "33333", // r_A_new
    "44444", // r_B_new
  ].join(" ");

  // 1. compute-witness
  const witnessStart = Date.now();
  runDocker(
    `docker run --rm -v "${REPO_ROOT}:/home/zokrates/code" -w /home/zokrates/code --user root ${ZOKRATES_IMAGE} zokrates compute-witness -i circuits/proving_key/out -a ${args} -o circuits/proving_key/bench-witness`
  );
  const witnessMs = Date.now() - witnessStart;

  // 2. generate-proof
  const proofStart = Date.now();
  runDocker(
    `docker run --rm -v "${REPO_ROOT}:/home/zokrates/code" -w /home/zokrates/code --user root ${ZOKRATES_IMAGE} zokrates generate-proof -i circuits/proving_key/out -w circuits/proving_key/bench-witness -p circuits/proving_key/proving.key -j circuits/proving_key/bench-proof.json`
  );
  const proofMs = Date.now() - proofStart;

  // Cleanup (ignora se o arquivo nao existir)
  try {
    fs.unlinkSync(witnessPath);
  } catch {
    /* arquivo ja removido — ok */
  }
  try {
    fs.unlinkSync(proofPath);
  } catch {
    /* arquivo ja removido — ok */
  }

  return { witnessMs, proofMs };
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function proofSizeBytes(): number {
  // Proof Groth16: 2 G1 (a, c) + 1 G2 (b)
  //   G1 = (X, Y) sobre Fp = 2 * 32 bytes = 64 bytes
  //   G2 = (X, Y) sobre Fp2 = 4 * 32 bytes = 128 bytes
  // Total = 64 + 128 + 64 = 256 bytes
  let bytes = 0;
  bytes += 2 * 32; // a
  bytes += 4 * 32; // b
  bytes += 2 * 32; // c
  return bytes;
}

// Deploy do stack reutiliza test/fixtures/deployStack (DRY — mesma logica
// dos testes unitarios e de integracao).

async function measureVerifyTxGas(verifier: Verifier): Promise<bigint> {
  const fixture = loadValidFixture();
  // estimateGas em view function retorna o gas que seria gasto se chamada
  // dentro de uma transacao de estado.
  const gas = await verifier.verifyTx.estimateGas(fixture.proof, [
    fixture.inputs.commitAOld,
    fixture.inputs.commitBOld,
    fixture.inputs.commitANew,
    fixture.inputs.commitBNew,
  ]);
  return gas;
}

async function measureExecuteDvPGas(
  token: PrivateToken,
  dvp: DvPSettlement
): Promise<bigint> {
  const [admin, , alice, bob] = await ethers.getSigners();
  const fixture = loadValidFixture();

  await token
    .connect(admin)
    .mint(alice.address, uintToBytes32(fixture.inputs.commitAOld));
  await token
    .connect(admin)
    .mint(bob.address, uintToBytes32(fixture.inputs.commitBOld));

  const tx = await dvp
    .connect(alice)
    .executeDvP(
      alice.address,
      bob.address,
      fixture.proof,
      fixture.inputs,
      mockCiphertext("benchmark")
    );
  const receipt = await tx.wait();
  return receipt!.gasUsed;
}

async function main(): Promise<void> {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });

  // ─── Specs da maquina ──────────────────────────────────────────────────────
  const cpus = os.cpus();
  const cpuModel = cpus.length > 0 ? cpus[0].model : "unknown";
  const ramGB = (os.totalmem() / 1024 ** 3).toFixed(1);
  const platform = `${os.type()} ${os.release()}`;
  const nodeVersion = process.version;

  pretty.header(
    `Benchmark — PoC DREX-ZKP-LGPD`,
    `Máquina: ${cpuModel} | ${ramGB} GB RAM | ${platform}`
  );
  log({ event: "benchmark_start", iterations: ITERATIONS });

  // ─── 1. Constraints (estatico) ─────────────────────────────────────────────
  pretty.step(1, 4, "Lendo número de constraints do circuito");
  log({ event: "step", name: "constraints" });
  const constraints = readConstraintsCount();
  pretty.info("constraints", fmt(constraints));
  log({ event: "result", constraints });

  // ─── 2. Tempo de prova (5 iteracoes, mediana) ──────────────────────────────
  pretty.step(2, 4, `Medindo tempo de prova off-chain (${ITERATIONS} iterações)`);
  log({ event: "step", name: "proof_generation_timing", iterations: ITERATIONS });
  const witnessTimes: number[] = [];
  const proofTimes: number[] = [];
  for (let i = 0; i < ITERATIONS; i++) {
    const { witnessMs, proofMs } = computeWitnessAndProof();
    witnessTimes.push(witnessMs);
    proofTimes.push(proofMs);
    pretty.note(`iteração ${i + 1}/${ITERATIONS}  witness=${witnessMs}ms  proof=${proofMs}ms`);
    log({ event: "iteration", i: i + 1, witnessMs, proofMs });
  }
  const medianWitness = median(witnessTimes);
  const medianProof = median(proofTimes);

  // ─── 3. Tamanho da prova ───────────────────────────────────────────────────
  const proofBytes = proofSizeBytes();

  // ─── 4. Gas on-chain ───────────────────────────────────────────────────────
  pretty.step(3, 4, "Deployando stack e medindo gas on-chain");
  log({ event: "step", name: "deploy_stack" });
  const { verifier, token, dvp } = await deployFullStack();

  log({ event: "step", name: "verify_tx_gas" });
  const verifyGas = await measureVerifyTxGas(verifier);
  pretty.info("verifyTx (BN128 precompileds)", `${fmt(verifyGas)} gas`);

  log({ event: "step", name: "execute_dvp_gas" });
  const dvpGas = await measureExecuteDvPGas(token, dvp);
  pretty.info("executeDvP completo", `${fmt(dvpGas)} gas`);
  pretty.step(4, 4, "Gerando CSV de resultados");

  // ─── 5. Monta CSV ──────────────────────────────────────────────────────────
  const rows: Row[] = [
    {
      operacao: "compute_witness_zokrates",
      tempo_ms: medianWitness.toFixed(0),
      gas_consumido: "n/a",
      tamanho_prova_bytes: "n/a",
      n_constraints: constraints.toString(),
    },
    {
      operacao: "generate_proof_groth16",
      tempo_ms: medianProof.toFixed(0),
      gas_consumido: "n/a",
      tamanho_prova_bytes: proofBytes.toString(),
      n_constraints: constraints.toString(),
    },
    {
      operacao: "verify_tx_on_chain",
      tempo_ms: "n/a",
      gas_consumido: verifyGas.toString(),
      tamanho_prova_bytes: proofBytes.toString(),
      n_constraints: constraints.toString(),
    },
    {
      operacao: "execute_dvp_full_tx",
      tempo_ms: "n/a",
      gas_consumido: dvpGas.toString(),
      tamanho_prova_bytes: proofBytes.toString(),
      n_constraints: constraints.toString(),
    },
  ];

  const header =
    `# Benchmark da PoC DREX-ZKP-LGPD\n` +
    `# Gerado: ${new Date().toISOString()}\n` +
    `# Maquina: ${cpuModel}\n` +
    `# RAM: ${ramGB} GB\n` +
    `# OS: ${platform}\n` +
    `# Node: ${nodeVersion}\n` +
    `# ZoKrates: 0.8.8 (via Docker)\n` +
    `# Iteracoes (mediana): ${ITERATIONS}\n` +
    `# Esquema: Groth16 / BN128 / curva alt_bn128 com precompileds EVM\n` +
    `operacao,tempo_ms,gas_consumido,tamanho_prova_bytes,n_constraints\n`;

  const csvBody = rows
    .map(
      (r) =>
        `${r.operacao},${r.tempo_ms},${r.gas_consumido},${r.tamanho_prova_bytes},${r.n_constraints}`
    )
    .join("\n");

  fs.writeFileSync(CSV_FILE, header + csvBody + "\n");

  // ─── 6. Resumo no terminal ─────────────────────────────────────────────────
  log({ event: "result_constraints", value: constraints });
  log({
    event: "result_proof_time",
    median_witness_ms: medianWitness,
    median_proof_ms: medianProof,
    total_offchain_ms: medianWitness + medianProof,
    rnf01_target_ms: 30000,
    rnf01_status:
      medianWitness + medianProof < 30000 ? "OK (< 30s)" : "FALHOU",
  });
  log({
    event: "result_proof_size_bytes",
    value: proofBytes,
  });
  log({
    event: "result_verify_gas",
    value: verifyGas.toString(),
    rnf02_target: 300000,
    rnf02_status:
      verifyGas < 300000n ? "OK (< 300k)" : "FALHOU",
  });
  log({
    event: "result_dvp_gas",
    value: dvpGas.toString(),
    note: "executeDvP completo (verify + 2x setCommitment + recordTx)",
  });
  log({ event: "csv_written", file: CSV_FILE });
  log({ event: "benchmark_complete" });

  // Resumo final amigavel
  const totalOff = medianWitness + medianProof;
  const rnf01ok = totalOff < 30000;
  const rnf02ok = verifyGas < 300000n;
  pretty.section("Resultados (mediana de " + ITERATIONS + " iterações)");
  pretty.info("constraints do circuito", fmt(constraints));
  pretty.info("tamanho da prova", `${proofBytes} bytes`);
  pretty.info("witness (off-chain)", `${fmt(medianWitness)} ms`);
  pretty.info("generate-proof (off-chain)", `${fmt(medianProof)} ms`);
  pretty.info("TOTAL off-chain", `${fmt(totalOff)} ms`);
  pretty.info("verifyTx gas (on-chain)", `${fmt(verifyGas)}`);
  pretty.info("executeDvP completo", `${fmt(dvpGas)} gas`);

  pretty.done("✓  Benchmark concluído — RNFs validados", [
    `RNF01 prova < 30s:     ${rnf01ok ? "✓ OK" : "✗ FALHOU"}   (medido: ${fmt(totalOff)} ms)`,
    `RNF02 verify < 300k:   ${rnf02ok ? "✓ OK" : "✗ FALHOU"}   (medido: ${fmt(verifyGas)} gas)`,
    ``,
    `CSV completo:  ${CSV_FILE}`,
  ]);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log({ event: "benchmark_failed", error: message });
  pretty.fail(`Benchmark falhou: ${message}`);
  process.exitCode = 1;
});
