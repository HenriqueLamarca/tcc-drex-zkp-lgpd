import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "hardhat-gas-reporter";
import "solidity-coverage";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      evmVersion: "london",
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
      accounts: {
        count: 10,
        accountsBalance: "10000000000000000000000",
      },
    },
    besu: {
      url: process.env.BESU_RPC_URL ?? "http://localhost:8545",
      chainId: 1337,
      accounts: process.env.BESU_PRIVATE_KEYS
        ? process.env.BESU_PRIVATE_KEYS.split(",")
        : [],
      timeout: 60000,
    },
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    outputFile: "benchmark/results/gas-report.txt",
    noColors: true,
    currency: "BRL",
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
  typechain: {
    outDir: "typechain-types",
    target: "ethers-v6",
  },
  mocha: {
    timeout: 120000,
  },
};

export default config;
