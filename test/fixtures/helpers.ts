// =============================================================================
// helpers.ts — Utilitários para os testes unitários e de integração.
//
// Carrega fixtures de prova geradas off-chain (scripts/03_generate_test_fixtures.sh)
// e converte para os tipos que ethers v6 espera ao chamar Verifier.verifyTx.
// =============================================================================

import fs from "fs";
import path from "path";

const FIXTURES_DIR = path.join(__dirname);

export interface RawZokratesProof {
  scheme: string;
  curve: string;
  proof: {
    a: [string, string];
    b: [[string, string], [string, string]];
    c: [string, string];
  };
  inputs: string[];
}

export interface VerifierProof {
  a: { X: bigint; Y: bigint };
  b: { X: [bigint, bigint]; Y: [bigint, bigint] };
  c: { X: bigint; Y: bigint };
}

export interface DvPFixture {
  proof: VerifierProof;
  inputs: {
    commitAOld: bigint;
    commitBOld: bigint;
    commitANew: bigint;
    commitBNew: bigint;
  };
  raw: RawZokratesProof;
}

/**
 * Carrega a fixture valid-proof.json e converte para o formato do Verifier.
 */
export function loadValidFixture(): DvPFixture {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, "valid-proof.json"), "utf-8")
  ) as RawZokratesProof;

  return buildFixture(raw);
}

/**
 * Constroi um VerifierProof a partir do JSON cru do ZoKrates.
 */
export function buildFixture(raw: RawZokratesProof): DvPFixture {
  const proof: VerifierProof = {
    a: { X: BigInt(raw.proof.a[0]), Y: BigInt(raw.proof.a[1]) },
    b: {
      X: [BigInt(raw.proof.b[0][0]), BigInt(raw.proof.b[0][1])],
      Y: [BigInt(raw.proof.b[1][0]), BigInt(raw.proof.b[1][1])],
    },
    c: { X: BigInt(raw.proof.c[0]), Y: BigInt(raw.proof.c[1]) },
  };

  const inputs = {
    commitAOld: BigInt(raw.inputs[0]),
    commitBOld: BigInt(raw.inputs[1]),
    commitANew: BigInt(raw.inputs[2]),
    commitBNew: BigInt(raw.inputs[3]),
  };

  return { proof, inputs, raw };
}

/**
 * Converte uma uint256 (bigint) em bytes32 hex de 32 bytes com zero-padding.
 * Espelha exatamente o que `bytes32(uint256(x))` produz em Solidity.
 */
export function uintToBytes32(x: bigint): string {
  return "0x" + x.toString(16).padStart(64, "0");
}

/**
 * Retorna um blob cifrado mockado (cumpre o requisito de não-vazio para
 * RegulatorViewer; em produção seria ECIES(regulatorPk, payload)).
 */
export function mockCiphertext(label = "default"): string {
  const tag = `ECIES_MOCK_${label}_${Date.now()}`;
  const hex = Buffer.from(tag, "utf-8").toString("hex");
  return "0x" + hex;
}
