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
