#!/usr/bin/env node
// =============================================================================
// dvp_reject_card.cjs - Comprovante de uma operação NÃO efetivada (DvP interativo).
//
// Node puro (sem dependências), no MESMO estilo dos quadros de scripts/_pretty.ts
// (WIDTH 72, bordas de caixa, cor desativada quando a saída não é TTY - como no
// painel). Recebe os dados por variáveis de ambiente:
//   DVP_FROM, DVP_TO, DVP_SA (saldo do pagador), DVP_VALUE (valor pedido),
//   DVP_REASON ("insufficient" | "invalid").
// =============================================================================
const WIDTH = 72;
const useColor = Boolean(process.stdout.isTTY);
const C = {
  reset: useColor ? "\x1b[0m" : "",
  bold: useColor ? "\x1b[1m" : "",
  red: useColor ? "\x1b[31m" : "",
};

function pad(s, w) {
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  return s + " ".repeat(Math.max(0, w - visible.length));
}

function card(title, lines) {
  const c = C.red;
  const border = "═".repeat(WIDTH - 2);
  const sep = "─".repeat(WIDTH - 2);
  console.log("");
  console.log(`${c}╔${border}╗${C.reset}`);
  console.log(`${c}║${C.reset} ${C.bold}${pad(title, WIDTH - 3)}${C.reset}${c}║${C.reset}`);
  console.log(`${c}╠${sep}╣${C.reset}`);
  for (const ln of lines) {
    console.log(`${c}║${C.reset} ${pad(ln, WIDTH - 3)}${c}║${C.reset}`);
  }
  console.log(`${c}╚${border}╝${C.reset}`);
}

const from = process.env.DVP_FROM || "Henrique Lamarca";
const to = process.env.DVP_TO || "Tassio Ferenzini";
const sA = process.env.DVP_SA || "100";
const value = process.env.DVP_VALUE || "?";
const reason = process.env.DVP_REASON || "insufficient";

const lines = [
  `Operação tentada:  ${from} -> ${to}`,
  "",
  `Valor solicitado:  ${value} DREX`,
  `Saldo do pagador:  ${sA} DREX`,
  "",
];
if (reason === "invalid") {
  lines.push("Motivo da recusa:  valor inválido (use um número positivo, até 2 casas).");
} else {
  lines.push("Motivo da recusa:  saldo insuficiente para o valor solicitado.");
  lines.push("A regra de solvência exige saldo maior ou igual ao valor;");
  lines.push("por isso o circuito sequer gerou a prova de conhecimento zero.");
}
lines.push("");
lines.push("Resultado: nenhuma liquidação - estado on-chain inalterado.");

card("COMPROVANTE - OPERAÇÃO NÃO EFETIVADA", lines);
