// =============================================================================
// _pretty.ts — Saída amigável para apresentação (com ANSI colors, caixas).
//
// Default: modo "pretty" (cores, caixas, ícones, passos numerados).
// Para o modo JSON estruturado (parseável por máquina / testes):
//   $env:LOG_FORMAT="json" no PowerShell, ou LOG_FORMAT=json em bash.
// Cores são auto-desabilitadas quando stdout não é TTY (pipe/redirect).
// =============================================================================

const PRETTY: boolean = process.env.LOG_FORMAT !== "json";
const USE_COLOR: boolean = PRETTY && Boolean(process.stdout.isTTY);

const C = {
  reset: USE_COLOR ? "\x1b[0m" : "",
  bold: USE_COLOR ? "\x1b[1m" : "",
  dim: USE_COLOR ? "\x1b[2m" : "",
  cyan: USE_COLOR ? "\x1b[36m" : "",
  green: USE_COLOR ? "\x1b[32m" : "",
  yellow: USE_COLOR ? "\x1b[33m" : "",
  red: USE_COLOR ? "\x1b[31m" : "",
  gray: USE_COLOR ? "\x1b[90m" : "",
  magenta: USE_COLOR ? "\x1b[35m" : "",
};

const WIDTH = 72;

function pad(s: string, w: number): string {
  // padEnd respeitando o tamanho visível (ignora códigos ANSI).
  // eslint-disable-next-line no-control-regex
  const visible = s.replace(/\x1b\[[0-9;]*m/g, "");
  return s + " ".repeat(Math.max(0, w - visible.length));
}

export function header(title: string, subtitle?: string): void {
  if (!PRETTY) return;
  const line = "═".repeat(WIDTH - 2);
  console.log(`${C.cyan}╔${line}╗${C.reset}`);
  console.log(`${C.cyan}║${C.reset} ${C.bold}${pad(title, WIDTH - 3)}${C.reset}${C.cyan}║${C.reset}`);
  if (subtitle) {
    console.log(`${C.cyan}║${C.reset} ${C.gray}${pad(subtitle, WIDTH - 3)}${C.reset}${C.cyan}║${C.reset}`);
  }
  console.log(`${C.cyan}╚${line}╝${C.reset}`);
}

export function step(n: number, total: number, label: string, ok = true): void {
  if (!PRETTY) return;
  const icon = ok ? `${C.green}✓${C.reset}` : `${C.red}✗${C.reset}`;
  const prefix = `${C.gray}[${n}/${total}]${C.reset}`;
  const visibleLen = label.length;
  const dots = ".".repeat(Math.max(3, WIDTH - 14 - visibleLen));
  console.log(`${prefix} ${label} ${C.gray}${dots}${C.reset} ${icon}`);
}

export function info(label: string, value: string | number | bigint): void {
  if (!PRETTY) return;
  console.log(`        ${C.gray}${label}:${C.reset} ${C.bold}${String(value)}${C.reset}`);
}

export function section(title: string): void {
  if (!PRETTY) return;
  console.log("");
  console.log(`${C.magenta}──── ${C.bold}${title}${C.reset} ${C.magenta}${"─".repeat(Math.max(3, WIDTH - 7 - title.length))}${C.reset}`);
}

export function note(text: string): void {
  if (!PRETTY) return;
  console.log(`        ${C.dim}${text}${C.reset}`);
}

export function success(text: string): void {
  if (!PRETTY) return;
  console.log(`${C.green}✓${C.reset} ${text}`);
}

export function warn(text: string): void {
  if (!PRETTY) return;
  console.log(`${C.yellow}!${C.reset} ${text}`);
}

export function fail(text: string): void {
  if (!PRETTY) return;
  console.log(`${C.red}✗${C.reset} ${text}`);
}

export function done(title: string, lines: string[]): void {
  if (!PRETTY) return;
  const line = "═".repeat(WIDTH - 2);
  console.log("");
  console.log(`${C.green}╔${line}╗${C.reset}`);
  console.log(`${C.green}║${C.reset} ${C.bold}${pad(title, WIDTH - 3)}${C.reset}${C.green}║${C.reset}`);
  if (lines.length > 0) {
    console.log(`${C.green}║${C.reset}${pad("", WIDTH - 2)}${C.green}║${C.reset}`);
    for (const ln of lines) {
      console.log(`${C.green}║${C.reset} ${pad(ln, WIDTH - 3)}${C.green}║${C.reset}`);
    }
  }
  console.log(`${C.green}╚${line}╝${C.reset}`);
}

/**
 * Comprovante visual da transação — emulando o que o regulador veria
 * após decifrar o blob ECIES off-chain. Mostra valores em claro porque
 * representa a visão privilegiada do regulador (LC 105/2001), NÃO algo
 * que apareça on-chain. Preserva a tese: a chain só tem hashes; este
 * recibo só existe porque o regulador usou sua chave privada.
 */
export interface ReceiptData {
  txHash: string;
  blockNumber: number | bigint;
  timestamp: string;
  network: string;
  gasUsed: string | bigint;
  from: { label: string; address: string; balanceBefore: string; balanceAfter: string };
  to:   { label: string; address: string; balanceBefore: string; balanceAfter: string };
  value: string;
  commitmentsBefore: { from: string; to: string };
  commitmentsAfter: { from: string; to: string };
}

function rowKV(k: string, v: string, innerWidth: number): string {
  const left = `  ${k}`;
  const right = v;
  const space = Math.max(2, innerWidth - left.length - right.length - 2);
  return `${left}${" ".repeat(space)}${right}  `;
}

function shortHash(h: string, head = 10, tail = 8): string {
  if (h.length <= head + tail + 1) return h;
  return `${h.slice(0, head)}…${h.slice(-tail)}`;
}

export function receipt(data: ReceiptData): void {
  if (!PRETTY) return;
  const INNER = WIDTH - 2;
  const line = "═".repeat(INNER);
  const sep  = "─".repeat(INNER);
  const blank = " ".repeat(INNER);

  const draw = (content: string) => {
    // Usa cor magenta nas bordas; pad respeitando ANSI dentro de content.
    console.log(`${C.magenta}║${C.reset}${pad(content, INNER)}${C.magenta}║${C.reset}`);
  };

  console.log("");
  console.log(`${C.magenta}╔${line}╗${C.reset}`);
  // Cabeçalho
  draw(pad(`  ${C.bold}COMPROVANTE DE LIQUIDAÇÃO — DvP DREX (visão do regulador)${C.reset}`, INNER));
  draw(blank);
  draw(`  ${C.dim}Emitido após decifragem ECIES do blob de auditoria.${C.reset}`);
  draw(`  ${C.dim}Os valores abaixo NÃO aparecem on-chain — só o regulador, com${C.reset}`);
  draw(`  ${C.dim}sua chave privada, consegue produzir este comprovante.${C.reset}`);
  console.log(`${C.magenta}╠${sep}╣${C.reset}`);

  // Dados da transação
  draw(`  ${C.bold}TRANSAÇÃO${C.reset}`);
  draw(rowKV("Rede",       data.network,                                 INNER));
  draw(rowKV("Tx hash",    shortHash(data.txHash),                        INNER));
  draw(rowKV("Bloco",      String(data.blockNumber),                      INNER));
  draw(rowKV("Timestamp",  data.timestamp,                                INNER));
  draw(rowKV("Gas",        String(data.gasUsed).replace(/\B(?=(\d{3})+(?!\d))/g, "."), INNER));
  draw(blank);

  // Pagador
  draw(`  ${C.bold}PAGADOR (${data.from.label})${C.reset}`);
  draw(rowKV("Endereço",       shortHash(data.from.address, 8, 6),       INNER));
  draw(rowKV("Saldo anterior", `${data.from.balanceBefore} DREX`,         INNER));
  draw(rowKV("Valor enviado",  `${C.red}- ${data.value} DREX${C.reset}`, INNER));
  draw(rowKV("Saldo atual",    `${C.bold}${data.from.balanceAfter} DREX${C.reset}`, INNER));
  draw(blank);

  // Recebedor
  draw(`  ${C.bold}RECEBEDOR (${data.to.label})${C.reset}`);
  draw(rowKV("Endereço",        shortHash(data.to.address, 8, 6),         INNER));
  draw(rowKV("Saldo anterior",  `${data.to.balanceBefore} DREX`,           INNER));
  draw(rowKV("Valor recebido",  `${C.green}+ ${data.value} DREX${C.reset}`, INNER));
  draw(rowKV("Saldo atual",     `${C.bold}${data.to.balanceAfter} DREX${C.reset}`, INNER));
  draw(blank);

  console.log(`${C.magenta}╠${sep}╣${C.reset}`);
  // Commitments — o que a chain de fato armazena
  draw(`  ${C.bold}COMMITMENTS Poseidon (o que está on-chain)${C.reset}`);
  draw(rowKV("Pagador  antes",   shortHash(data.commitmentsBefore.from, 14, 8), INNER));
  draw(rowKV("Pagador  depois",  shortHash(data.commitmentsAfter.from,  14, 8), INNER));
  draw(rowKV("Recebedor antes",  shortHash(data.commitmentsBefore.to,   14, 8), INNER));
  draw(rowKV("Recebedor depois", shortHash(data.commitmentsAfter.to,    14, 8), INNER));
  draw(blank);
  draw(`  ${C.dim}↑ Hashes Poseidon: irreversíveis sem a randomness do dono.${C.reset}`);
  draw(`  ${C.dim}   A LGPD (art. 5º XI) considera dado anonimizado.${C.reset}`);

  console.log(`${C.magenta}╚${line}╝${C.reset}`);
}

/**
 * Linha JSON estruturada (modo máquina). No modo pretty, é silenciosa.
 * Use para preservar a saída parseável quando LOG_FORMAT=json.
 */
export function json(payload: Record<string, unknown>): void {
  if (PRETTY) return;
  console.log(JSON.stringify(payload));
}

/**
 * Indica se estamos em modo pretty (útil para suprimir prints redundantes).
 */
export function isPretty(): boolean {
  return PRETTY;
}
