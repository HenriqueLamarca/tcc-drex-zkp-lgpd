// Configuração do solidity-coverage.
// Exclui Verifier.sol do cálculo: é arquivo auto-gerado pelo ZoKrates,
// fora do controle deste projeto.
module.exports = {
  skipFiles: ["Verifier.sol"],
  istanbulReporter: ["html", "json-summary", "text"],
};
