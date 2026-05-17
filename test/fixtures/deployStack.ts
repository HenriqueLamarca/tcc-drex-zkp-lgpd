// =============================================================================
// deployStack.ts — Deploy reutilizável dos 4 contratos + concessão de papéis.
//
// Centraliza a lógica de bootstrap usada por:
//   - test/unit/DvPSettlement.spec.ts
//   - test/integration/dvp.spec.ts
//   - benchmark/benchmark.ts
//
// Evita duplicação (~60 linhas repetidas em 3 arquivos). Espelha exatamente
// a sequência de scripts/04_deploy.ts: Verifier -> PrivateToken ->
// RegulatorViewer -> DvPSettlement, depois concede MINTER ao admin e
// SETTLEMENT ao DvPSettlement em PrivateToken e RegulatorViewer.
// =============================================================================

import { ethers } from "hardhat";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import {
  Verifier,
  PrivateToken,
  RegulatorViewer,
  DvPSettlement,
} from "../../typechain-types";

export interface DeployedStack {
  verifier: Verifier;
  token: PrivateToken;
  viewer: RegulatorViewer;
  dvp: DvPSettlement;
  /** signers[0] */
  admin: HardhatEthersSigner;
  /** signers[1] */
  regulator: HardhatEthersSigner;
  /** Lista completa de signers, para o consumidor nomear alice/bob/etc. */
  signers: HardhatEthersSigner[];
}

/**
 * Deploya o stack completo e concede os papéis padrão.
 * O consumidor decide quais signers usar como pagador/recebedor.
 */
export async function deployFullStack(): Promise<DeployedStack> {
  const signers = await ethers.getSigners();
  const [admin, regulator] = signers;

  const VFactory = await ethers.getContractFactory("Verifier");
  const verifier = (await VFactory.deploy()) as unknown as Verifier;
  await verifier.waitForDeployment();

  const TFactory = await ethers.getContractFactory("PrivateToken");
  const token = (await TFactory.deploy(
    admin.address
  )) as unknown as PrivateToken;
  await token.waitForDeployment();

  const RFactory = await ethers.getContractFactory("RegulatorViewer");
  const viewer = (await RFactory.deploy(
    admin.address,
    regulator.address
  )) as unknown as RegulatorViewer;
  await viewer.waitForDeployment();

  const DFactory = await ethers.getContractFactory("DvPSettlement");
  const dvp = (await DFactory.deploy(
    admin.address,
    await verifier.getAddress(),
    await token.getAddress(),
    await viewer.getAddress()
  )) as unknown as DvPSettlement;
  await dvp.waitForDeployment();

  // Papéis padrão (idênticos a scripts/04_deploy.ts)
  await token.connect(admin).grantRole(await token.MINTER_ROLE(), admin.address);
  await token
    .connect(admin)
    .grantRole(await token.SETTLEMENT_ROLE(), await dvp.getAddress());
  await viewer
    .connect(admin)
    .grantRole(await viewer.SETTLEMENT_ROLE(), await dvp.getAddress());

  return { verifier, token, viewer, dvp, admin, regulator, signers };
}
