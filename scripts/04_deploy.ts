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

function log(payload: Record<string, unknown>): void {
  console.log(JSON.stringify(payload));
}

async function main(): Promise<void> {
  const signers = await ethers.getSigners();
  const [admin, regulator] = signers;

  log({ event: "deploy_start", network: network.name, deployer: admin.address });

  // ─── 1. Verifier ───────────────────────────────────────────────────────────
  const VerifierFactory = await ethers.getContractFactory("Verifier");
  const verifier = (await VerifierFactory.deploy()) as unknown as Verifier;
  await verifier.waitForDeployment();
  const verifierAddr = await verifier.getAddress();
  log({ event: "deployed", contract: "Verifier", address: verifierAddr });

  // ─── 2. PrivateToken ───────────────────────────────────────────────────────
  const TokenFactory = await ethers.getContractFactory("PrivateToken");
  const token = (await TokenFactory.deploy(
    admin.address
  )) as unknown as PrivateToken;
  await token.waitForDeployment();
  const tokenAddr = await token.getAddress();
  log({ event: "deployed", contract: "PrivateToken", address: tokenAddr });

  // ─── 3. RegulatorViewer ────────────────────────────────────────────────────
  const ViewerFactory = await ethers.getContractFactory("RegulatorViewer");
  const viewer = (await ViewerFactory.deploy(
    admin.address,
    regulator.address
  )) as unknown as RegulatorViewer;
  await viewer.waitForDeployment();
  const viewerAddr = await viewer.getAddress();
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
  log({ event: "deployed", contract: "DvPSettlement", address: dvpAddr });

  // ─── 5. Concede SETTLEMENT_ROLE ────────────────────────────────────────────
  const tokenSettlementRole = await token.SETTLEMENT_ROLE();
  const viewerSettlementRole = await viewer.SETTLEMENT_ROLE();
  const minterRole = await token.MINTER_ROLE();

  const rolesGranted: DeploymentRecord["rolesGranted"] = [];

  await (
    await token.connect(admin).grantRole(tokenSettlementRole, dvpAddr)
  ).wait();
  rolesGranted.push({
    contract: "PrivateToken",
    role: "SETTLEMENT_ROLE",
    account: dvpAddr,
  });

  await (
    await viewer.connect(admin).grantRole(viewerSettlementRole, dvpAddr)
  ).wait();
  rolesGranted.push({
    contract: "RegulatorViewer",
    role: "SETTLEMENT_ROLE",
    account: dvpAddr,
  });

  await (await token.connect(admin).grantRole(minterRole, admin.address)).wait();
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
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  log({ event: "deploy_failed", error: message });
  process.exitCode = 1;
});
