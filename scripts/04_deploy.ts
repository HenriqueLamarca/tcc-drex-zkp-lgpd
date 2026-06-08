// =============================================================================
// 04_deploy.ts — Deploy dos 4 contratos da PoC + concessao de papeis.
//
// Sequencia:
//   1. Verifier (gerado pelo ZoKrates)
//   2. PrivateToken (constructor: admin)
//   3. RegulatorViewer (constructor: admin, regulator)
//   4. DvPSettlement (constructor: admin, verifier, token, viewer)
//   5. Concede SETTLEMENT_ROLE ao DvPSettlement em PrivateToken e RegulatorViewer
//   6. Concede MINTER_ROLE ao admin (para fluxo de demo/teste)
//   7. Salva enderecos + papeis em deployments/<network>.json
//
// Uso:
//   npx hardhat run scripts/04_deploy.ts --network besu
//   npx hardhat run scripts/04_deploy.ts --network hardhat
//
// Logs estruturados em JSON (RNF06). Nenhum dado privado e' emitido.
// =============================================================================

import { ethers, network } from "hardhat";
import fs from "fs";
import path from "path";
import {
  Verifier,
  PrivateToken,
  RegulatorViewer,
  DvPSettlement,
} from "../typechain-types";

interface DeploymentRecord {
  network: string;
  chainId: number;
  timestamp: string;
  blockNumber: number;
  deployer: string;
  regulator: string;
  contracts: {
    Verifier: string;
    PrivateToken: string;
    RegulatorViewer: string;
    DvPSettlement: string;
  };
  rolesGranted: Array<{ contract: string; role: string; account: string }>;
}

import * as pretty from "./_pretty";

function log(payload: Record<string, unknown>): void {
  pretty.json(payload);
}

function short(addr: string): string {
  return addr.slice(0, 6) + "…" + addr.slice(-4);
}

async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  if (signers.length < 2) {
    pretty.fail(
      `Apenas ${signers.length} signer(s) disponível(eis) na rede "${network.name}". ` +
        `São necessários pelo menos 2 (admin + regulador).`
    );
    if (network.name === "besu") {
      pretty.note(
        "Para a rede besu, exporte a variável BESU_PRIVATE_KEYS com 4 chaves pré-financiadas. " +
          'Exemplo (PowerShell): $env:BESU_PRIVATE_KEYS="0x...,0x...,0x...,0x..."'
      );
      pretty.note("Veja docs/USAGE.md ou docs/REPRODUCIBILITY.md para as chaves de teste.");
    }
    process.exit(1);
  }
  const [admin, regulator] = signers;

  pretty.header(
    `Deploy dos contratos da PoC — rede: ${network.name}`,
    `Deployer: ${short(admin.address)}   |   Regulador: ${short(regulator.address)}`
  );
  log({ event: "deploy_start", network: network.name, deployer: admin.address });

  // ─── 1. Verifier ───────────────────────────────────────────────────────────
  const VerifierFactory = await ethers.getContractFactory("Verifier");
  const verifier = (await VerifierFactory.deploy()) as unknown as Verifier;
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  pretty.step(1, 4, "Verifier.sol (verificador Groth16)");
  pretty.info("endereço", short(verifierAddr));
  log({ event: "deployed", contract: "Verifier", address: verifierAddr });

  // ─── 2. PrivateToken ───────────────────────────────────────────────────────
  const TokenFactory = await ethers.getContractFactory("PrivateToken");
  const token = (await TokenFactory.deploy(
    admin.address
  )) as unknown as PrivateToken;
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  pretty.step(2, 4, "PrivateToken.sol (cofre de commitments)");
  pretty.info("endereço", short(tokenAddr));
  log({ event: "deployed", contract: "PrivateToken", address: tokenAddr });

  // ─── 3. RegulatorViewer ────────────────────────────────────────────────────
  const ViewerFactory = await ethers.getContractFactory("RegulatorViewer");
  const viewer = (await ViewerFactory.deploy(
    admin.address,
    regulator.address
  )) as unknown as RegulatorViewer;
  await viewer.waitForDeployment();
  const viewerAddr = await viewer.getAddress();
  pretty.step(3, 4, "RegulatorViewer.sol (trilha cifrada do regulador)");
  pretty.info("endereço", short(viewerAddr));
  log({ event: "deployed", contract: "RegulatorViewer", address: viewerAddr });

  // ─── 4. DvPSettlement ──────────────────────────────────────────────────────
  const DvPFactory = await ethers.getContractFactory("DvPSettlement");
  const dvp = (await DvPFactory.deploy(
    admin.address,
    verifierAddr,
    tokenAddr,
    viewerAddr
  )) as unknown as DvPSettlement;
  await dvp.waitForDeployment();
  const dvpAddr = await dvp.getAddress();
  pretty.step(4, 4, "DvPSettlement.sol (orquestrador atômico)");
  pretty.info("endereço", short(dvpAddr));
  log({ event: "deployed", contract: "DvPSettlement", address: dvpAddr });

  // ─── 5. Concede SETTLEMENT_ROLE ────────────────────────────────────────────
  pretty.section("Concedendo papéis (AccessControl)");
  const tokenSettlementRole = await token.SETTLEMENT_ROLE();
  const viewerSettlementRole = await viewer.SETTLEMENT_ROLE();
  const minterRole = await token.MINTER_ROLE();

  const rolesGranted: DeploymentRecord["rolesGranted"] = [];

  await (
    await token.connect(admin).grantRole(tokenSettlementRole, dvpAddr)
  ).wait();
  pretty.success(`PrivateToken → SETTLEMENT_ROLE para DvPSettlement`);
  rolesGranted.push({
    contract: "PrivateToken",
    role: "SETTLEMENT_ROLE",
    account: dvpAddr,
  });

  await (
    await viewer.connect(admin).grantRole(viewerSettlementRole, dvpAddr)
  ).wait();
  pretty.success(`RegulatorViewer → SETTLEMENT_ROLE para DvPSettlement`);
  rolesGranted.push({
    contract: "RegulatorViewer",
    role: "SETTLEMENT_ROLE",
    account: dvpAddr,
  });

  await (await token.connect(admin).grantRole(minterRole, admin.address)).wait();
  pretty.success(`PrivateToken → MINTER_ROLE para o admin`);
  rolesGranted.push({
    contract: "PrivateToken",
    role: "MINTER_ROLE",
    account: admin.address,
  });

  log({ event: "roles_granted", count: rolesGranted.length });

  // ─── 6. Persiste deployment ────────────────────────────────────────────────
  const chainId = Number((await ethers.provider.getNetwork()).chainId);
  const blockNumber = await ethers.provider.getBlockNumber();

  const record: DeploymentRecord = {
    network: network.name,
    chainId,
    timestamp: new Date().toISOString(),
    blockNumber,
    deployer: admin.address,
    regulator: regulator.address,
    contracts: {
      Verifier: verifierAddr,
      PrivateToken: tokenAddr,
      RegulatorViewer: viewerAddr,
      DvPSettlement: dvpAddr,
    },
    rolesGranted,
  };

  const outDir = path.join(__dirname, "..", "deployments");
  fs.mkdirSync(outDir, { recursive: true });
  const outFile = path.join(outDir, `${network.name}.json`);
  fs.writeFileSync(outFile, JSON.stringify(record, null, 2));

  log({ event: "deploy_complete", file: outFile });
  log({ event: "summary", ...record });

  pretty.done("✓  Deploy concluído com sucesso", [
    `Rede:        ${network.name}  (chainId ${chainId})`,
    `Bloco:       ${blockNumber}`,
    `Contratos:   4   |   Papéis concedidos: ${rolesGranted.length}`,
    `Endereços salvos em:  deployments/${network.name}.json`,
  ]);
}

main()
  .then(() => {
    // Sinaliza sucesso por arquivo-sentinela ANTES do exit. No Windows, o
    // teardown do provider Hardhat/ethers pode disparar um assert do libuv
    // ("!(handle->flags & UV_HANDLE_CLOSING)") que sobrescreve o codigo de
    // saida. O Makefile confere este sentinela em vez do exit code, tornando
    // a deteccao de sucesso deterministica e independente do crash de teardown.
    try { fs.writeFileSync(".make_step.ok", "deploy"); } catch {}
    process.exit(0);
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    log({ event: "deploy_failed", error: message });
    pretty.fail(`Deploy falhou: ${message}`);
    process.exit(1);
  });
