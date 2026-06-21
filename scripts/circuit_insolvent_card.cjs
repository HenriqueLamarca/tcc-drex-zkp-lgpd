#!/usr/bin/env node
// =============================================================================
// circuit_insolvent_card.cjs - Comprovante da demonstracao "gastar sem saldo".
//
// Mostra que a barreira contra uma transferencia insolvente e' CRIPTOGRAFICA e
// ANTERIOR a rede: o circuito de conhecimento zero (ZoKrates) se recusa a gerar
// a prova quando saldo < valor. Node puro, no mesmo estilo de _pretty.ts
// (WIDTH 72, cor desativada fora de TTY - como no painel). Dados por ambiente:
//   DVP_FROM, DVP_TO, DVP_SA (saldo do pagador), DVP_VALUE (valor tentado).
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
const value = process.env.DVP_VALUE || "150";

card("COMPROVANTE - TRANSFERENCIA INSOLVENTE BLOQUEADA", [
  `Tentativa:         ${from} -> ${to}`,
  "",
  `Saldo do pagador:  ${sA} DREX`,
  `Valor tentado:     ${value} DREX   (acima do saldo)`,
  "",
  "O circuito de conhecimento zero impoe assert(saldo >= valor).",
  `Como ${sA} < ${value}, o proprio prover (ZoKrates) RECUSOU gerar a prova:`,
  "nao existe prova a submeter -> a rede sequer e' acionada.",
  "",
  "Diferenca p/ a 'liquidacao invalida': la, uma prova adulterada e'",
  "barrada ON-CHAIN; aqui a barreira e' ANTERIOR e criptografica.",
  "",
  "Resultado: nenhuma liquidacao - estado on-chain inalterado.",
  "Recusa do circuito = seguranca validada.",
]);
