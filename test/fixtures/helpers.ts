// =============================================================================
// helpers.ts — Utilitários para os testes unitários e de integração.
//
// Carrega fixtures de prova geradas off-chain (scripts/03_generate_test_fixtures.sh)
// e converte para os tipos que ethers v6 espera ao chamar Verifier.verifyTx.
// =============================================================================

import fs from "fs";
import path from "path";
import { encrypt, decrypt, PrivateKey } from "eciesjs";

const FIXTURES_DIR = path.join(__dirname);

// Formato cru do proof.json emitido pelo ZoKrates. Detalhe interno —
// nao exportado porque nenhum consumidor o usa diretamente.
interface RawZokratesProof {
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
}

/**
 * Carrega a fixture valid-proof.json e converte para o formato do Verifier.
 */
export function loadValidFixture(): DvPFixture {
  const raw = JSON.parse(
    fs.readFileSync(path.join(FIXTURES_DIR, "valid-proof.json"), "utf-8")
  ) as RawZokratesProof;

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

  return { proof, inputs };
}

/**
 * Converte uma uint256 (bigint) em bytes32 hex de 32 bytes com zero-padding.
 * Espelha exatamente o que `bytes32(uint256(x))` produz em Solidity.
 */
export function uintToBytes32(x: bigint): string {
  return "0x" + x.toString(16).padStart(64, "0");
}

/**
 * Blob não-vazio simples para testes unitários do contrato, que validam
 * apenas a lógica on-chain (o contrato trata o ciphertext como bytes
 * opacos). Os testes de integração e a demo usam ECIES real
 * (encryptForRegulator) para exercer o fluxo criptográfico completo.
 */
export function mockCiphertext(label = "default"): string {
  const tag = `ECIES_MOCK_${label}_${Date.now()}`;
  const hex = Buffer.from(tag, "utf-8").toString("hex");
  return "0x" + hex;
}

// ─── ECIES real (secp256k1) — cliente cifra para o regulador ────────────────
//
// O regulador detém um par de chaves secp256k1 (mesma curva do Ethereum).
// O cliente do pagador cifra o payload de auditoria com a chave PÚBLICA do
// regulador; só o regulador, com a chave PRIVADA, decifra off-chain.
// Esquema: ECIES (ECDH secp256k1 + HKDF + AES-256-GCM) via biblioteca eciesjs.
//
// AVISO: a chave privada abaixo é DETERMINÍSTICA e EXCLUSIVA PARA TESTES.
// Em produção, a chave privada do regulador residiria em HSM e jamais
// apareceria em código (ver THREAT_MODEL I4).

const REGULATOR_TEST_SK =
  "0x9d61b19deffd5a60ba844af492ec2cc44449c5697b326919703bac031cae7f60";

/** Carrega o par de chaves de teste do regulador. */
function regulatorKey(): PrivateKey {
  return PrivateKey.fromHex(REGULATOR_TEST_SK);
}

/** Chave pública (hex 0x, comprimida) do regulador — usada pelo cliente. */
export function regulatorPublicKeyHex(): string {
  return regulatorKey().publicKey.toHex();
}

export interface RegulatorPayload {
  from: string;
  to: string;
  value: string;
  timestamp: string;
}

/**
 * Cifra o payload de auditoria para o regulador (papel do cliente do pagador).
 * @returns blob ECIES como hex `0x...` pronto para `RegulatorViewer.recordTx`.
 */
export function encryptForRegulator(payload: RegulatorPayload): string {
  const plaintext = Buffer.from(JSON.stringify(payload), "utf-8");
  const blob = encrypt(regulatorPublicKeyHex(), plaintext);
  return "0x" + Buffer.from(blob).toString("hex");
}

/**
 * Decifra o blob ECIES (papel do regulador, off-chain, com a chave privada).
 */
export function decryptAsRegulator(blobHex: string): RegulatorPayload {
  const blob = Buffer.from(blobHex.replace(/^0x/, ""), "hex");
  const plaintext = Buffer.from(decrypt(regulatorKey().secret, blob)).toString(
    "utf-8"
  );
  return JSON.parse(plaintext) as RegulatorPayload;
}
