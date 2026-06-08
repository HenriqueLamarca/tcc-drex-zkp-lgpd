// =============================================================================
// generate_svgs.ts - Gera SVGs estaticos para a monografia.
//
// Sem dependencias externas: gera SVG via string templates puros.
// Outputs:
//   docs/figures/architecture.svg
//   docs/figures/dvp_sequence.svg
//   docs/figures/benchmark_proof_time.svg
//   docs/figures/benchmark_gas.svg
//   docs/figures/benchmark_constraints.svg
//
// Uso:
//   npx ts-node docs/figures/generate_svgs.ts
// =============================================================================

import fs from "fs";
import path from "path";

const OUT_DIR = __dirname;

// ─── Utilitarios SVG ─────────────────────────────────────────────────────────

function svgWrap(width: number, height: number, content: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" font-family="Arial, sans-serif">
  <style>
    .title { font-size: 16px; font-weight: bold; fill: #1a1a1a; }
    .subtitle { font-size: 11px; fill: #555; }
    .label { font-size: 11px; fill: #1a1a1a; }
    .label-small { font-size: 10px; fill: #555; }
    .axis { stroke: #888; stroke-width: 1; }
    .grid { stroke: #ddd; stroke-width: 0.5; stroke-dasharray: 3,3; }
    .bar-good { fill: #2e8b57; }
    .bar-warn { fill: #d97706; }
    .bar-info { fill: #2563eb; }
    .bar-neutral { fill: #6b7280; }
    .threshold { stroke: #dc2626; stroke-width: 1.5; stroke-dasharray: 6,3; }
    .threshold-label { font-size: 10px; fill: #dc2626; font-weight: bold; }
    .box { fill: #f8f9fb; stroke: #1f3a5f; stroke-width: 1.5; rx: 6; ry: 6; }
    .box-text { font-size: 11px; fill: #1a1a1a; text-anchor: middle; }
    .arrow { stroke: #555; stroke-width: 1.2; fill: none; marker-end: url(#arrow); }
    .arrow-text { font-size: 9px; fill: #444; }
    .role { fill: #fef3c7; stroke: #d97706; stroke-width: 1; rx: 4; ry: 4; }
  </style>
  <defs>
    <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto">
      <path d="M0,0 L10,5 L0,10 z" fill="#555"/>
    </marker>
  </defs>
${content}
</svg>`;
}

// ─── Diagrama 1: Arquitetura de Componentes ─────────────────────────────────

function generateArchitectureSVG(): string {
  const W = 900;
  const H = 600;

  const content = `
  <text x="${W / 2}" y="30" text-anchor="middle" class="title">Arquitetura da PoC DREX-ZKP-LGPD</text>
  <text x="${W / 2}" y="48" text-anchor="middle" class="subtitle">Cliente off-chain | Hyperledger Besu QBFT | Regulador off-chain</text>

  <!-- Grupo Cliente -->
  <rect x="30" y="80" width="240" height="440" fill="#e8f4f8" stroke="#0e6e8c" stroke-width="2" rx="8"/>
  <text x="150" y="105" text-anchor="middle" class="label" font-weight="bold">Cliente off-chain</text>
  <text x="150" y="120" text-anchor="middle" class="subtitle">(titular do saldo)</text>

  <rect x="55" y="150" width="190" height="55" class="box"/>
  <text x="150" y="172" class="box-text" font-weight="bold">Wallet</text>
  <text x="150" y="190" class="box-text label-small">value, randomness</text>

  <rect x="55" y="230" width="190" height="55" class="box"/>
  <text x="150" y="252" class="box-text" font-weight="bold">ZoKrates Docker</text>
  <text x="150" y="270" class="box-text label-small">compute-witness + proof</text>

  <rect x="55" y="310" width="190" height="55" class="box"/>
  <text x="150" y="332" class="box-text" font-weight="bold">ECIES Encryptor</text>
  <text x="150" y="350" class="box-text label-small">payload p/ regulator</text>

  <!-- Grupo Besu -->
  <rect x="320" y="80" width="370" height="440" fill="#fff4e6" stroke="#cc8800" stroke-width="2" rx="8"/>
  <text x="505" y="105" text-anchor="middle" class="label" font-weight="bold">Hyperledger Besu QBFT</text>
  <text x="505" y="120" text-anchor="middle" class="subtitle">(4 validadores permissionados)</text>

  <rect x="345" y="150" width="320" height="60" class="box"/>
  <text x="505" y="172" class="box-text" font-weight="bold">DvPSettlement.sol</text>
  <text x="505" y="190" class="box-text label-small">orquestra DvP atomico</text>
  <text x="505" y="204" class="box-text label-small">rate limit + ReentrancyGuard</text>

  <rect x="345" y="240" width="155" height="60" class="box"/>
  <text x="422" y="262" class="box-text" font-weight="bold">Verifier.sol</text>
  <text x="422" y="280" class="box-text label-small">Groth16 / BN128</text>
  <text x="422" y="294" class="box-text label-small">precompileds 0x06-0x08</text>

  <rect x="510" y="240" width="155" height="60" class="box"/>
  <text x="587" y="262" class="box-text" font-weight="bold">PrivateToken.sol</text>
  <text x="587" y="280" class="box-text label-small">commitments por addr</text>
  <text x="587" y="294" class="box-text label-small">cryptoShred (RF06)</text>

  <rect x="345" y="330" width="320" height="60" class="box"/>
  <text x="505" y="352" class="box-text" font-weight="bold">RegulatorViewer.sol</text>
  <text x="505" y="370" class="box-text label-small">audit trail cifrado</text>
  <text x="505" y="384" class="box-text label-small">getEncryptedTx (REGULATOR_ROLE)</text>

  <!-- Validadores QBFT -->
  <text x="505" y="425" text-anchor="middle" class="label-small" font-weight="bold">Consenso QBFT</text>
  <circle cx="395" cy="455" r="20" fill="#fef3c7" stroke="#d97706"/>
  <text x="395" y="460" text-anchor="middle" class="label-small">node-1</text>
  <circle cx="465" cy="455" r="20" fill="#fef3c7" stroke="#d97706"/>
  <text x="465" y="460" text-anchor="middle" class="label-small">node-2</text>
  <circle cx="535" cy="455" r="20" fill="#fef3c7" stroke="#d97706"/>
  <text x="535" y="460" text-anchor="middle" class="label-small">node-3</text>
  <circle cx="605" cy="455" r="20" fill="#fef3c7" stroke="#d97706"/>
  <text x="605" y="460" text-anchor="middle" class="label-small">node-4</text>
  <text x="505" y="500" text-anchor="middle" class="label-small">f = 1 (toleramos 1 bizantino)</text>

  <!-- Grupo Regulador -->
  <rect x="740" y="80" width="130" height="440" fill="#f0f0f5" stroke="#555" stroke-width="2" rx="8"/>
  <text x="805" y="105" text-anchor="middle" class="label" font-weight="bold">Regulador</text>
  <text x="805" y="120" text-anchor="middle" class="subtitle">(REGULATOR_ROLE)</text>

  <rect x="755" y="190" width="100" height="50" class="box"/>
  <text x="805" y="210" class="box-text" font-weight="bold">ECIES</text>
  <text x="805" y="226" class="box-text label-small">Decryptor</text>

  <rect x="755" y="290" width="100" height="50" class="box"/>
  <text x="805" y="310" class="box-text" font-weight="bold">Auditoria</text>
  <text x="805" y="326" class="box-text label-small">LC 105/2001</text>

  <!-- Setas de fluxo -->
  <path d="M 245 257 L 320 197" class="arrow"/>
  <text x="280" y="220" class="arrow-text">prova + inputs</text>

  <path d="M 245 337 L 320 360" class="arrow"/>
  <text x="277" y="354" class="arrow-text">ciphertext</text>

  <path d="M 665 360 L 740 215" class="arrow"/>
  <text x="700" y="280" class="arrow-text" transform="rotate(-50 700 280)">getEncryptedTx</text>
  `;

  return svgWrap(W, H, content);
}

// ─── Diagrama 2: Sequencia DvP (simplificado) ───────────────────────────────

function generateSequenceSVG(): string {
  const W = 1000;
  const H = 700;
  const lanes = [
    { x: 80, label: "Alice (Cliente)" },
    { x: 220, label: "ZoKrates" },
    { x: 360, label: "DvPSettlement" },
    { x: 500, label: "Verifier" },
    { x: 640, label: "PrivateToken" },
    { x: 780, label: "RegulatorViewer" },
    { x: 920, label: "Regulador" },
  ];

  // Eventos: y, from, to, label, dashed?
  const events = [
    { y: 130, from: 0, to: 1, label: "compute-witness" },
    { y: 160, from: 1, to: 0, label: "witness", dashed: true },
    { y: 190, from: 0, to: 1, label: "generate-proof" },
    { y: 220, from: 1, to: 0, label: "proof.json (256B)", dashed: true },
    { y: 270, from: 0, to: 2, label: "executeDvP(proof, inputs, ciphertext)" },
    { y: 305, from: 2, to: 4, label: "read commitments[A,B]" },
    { y: 335, from: 4, to: 2, label: "current hashes", dashed: true },
    { y: 365, from: 2, to: 3, label: "verifyTx(proof, inputs)" },
    { y: 395, from: 3, to: 2, label: "true (BN128 pairing OK)", dashed: true },
    { y: 425, from: 2, to: 4, label: "setCommitment(A, new)" },
    { y: 455, from: 2, to: 4, label: "setCommitment(B, new)" },
    { y: 485, from: 2, to: 5, label: "recordTx(A, B, ciphertext)" },
    { y: 515, from: 5, to: 2, label: "txId", dashed: true },
    { y: 545, from: 2, to: 0, label: "tx confirmada (DvPSettled)", dashed: true },
    { y: 605, from: 6, to: 5, label: "getEncryptedTx(txId)" },
    { y: 635, from: 5, to: 6, label: "EncryptedRecord", dashed: true },
  ];

  let content = `
  <text x="${W / 2}" y="30" text-anchor="middle" class="title">Sequencia da transacao DvP ponta-a-ponta</text>
  <text x="${W / 2}" y="48" text-anchor="middle" class="subtitle">Off-chain (1-4) | On-chain atomico (5-14) | Auditoria assincrona (15-16)</text>
  `;

  // Lanes
  for (const lane of lanes) {
    content += `
  <rect x="${lane.x - 50}" y="70" width="100" height="30" fill="#1f3a5f" rx="4"/>
  <text x="${lane.x}" y="90" text-anchor="middle" fill="white" font-size="11" font-weight="bold">${lane.label}</text>
  <line x1="${lane.x}" y1="100" x2="${lane.x}" y2="${H - 30}" class="grid"/>
    `;
  }

  // Section dividers
  content += `
  <line x1="20" y1="245" x2="${W - 20}" y2="245" stroke="#aaa" stroke-width="0.5" stroke-dasharray="6,3"/>
  <text x="40" y="260" class="label-small" font-style="italic">--- on-chain (atomico) ---</text>
  <line x1="20" y1="580" x2="${W - 20}" y2="580" stroke="#aaa" stroke-width="0.5" stroke-dasharray="6,3"/>
  <text x="40" y="595" class="label-small" font-style="italic">--- auditoria assincrona ---</text>
  `;

  // Events
  events.forEach((e, i) => {
    const fromX = lanes[e.from].x;
    const toX = lanes[e.to].x;
    const dash = e.dashed ? 'stroke-dasharray="5,3"' : "";
    const midX = (fromX + toX) / 2;
    content += `
  <line x1="${fromX}" y1="${e.y}" x2="${toX}" y2="${e.y}" class="arrow" ${dash}/>
  <text x="${midX}" y="${e.y - 5}" text-anchor="middle" class="arrow-text">${i + 1}. ${e.label}</text>
    `;
  });

  return svgWrap(W, H, content);
}

// ─── Charts de benchmark (barras simples) ────────────────────────────────────

interface BarSpec {
  label: string;
  value: number;
  className: string;
  displayValue?: string;
}

interface BarChartOptions {
  title: string;
  subtitle: string;
  bars: BarSpec[];
  maxValue: number;
  threshold?: { value: number; label: string };
  unit: string;
}

function generateBarChartSVG(opts: BarChartOptions): string {
  const W = 700;
  const H = 400;
  const chartLeft = 180;
  const chartRight = 600;
  const chartTop = 100;
  const chartBottom = 320;
  const chartHeight = chartBottom - chartTop;
  const chartWidth = chartRight - chartLeft;
  const barHeight = chartHeight / (opts.bars.length * 1.6);
  const barGap = barHeight * 0.6;

  let content = `
  <text x="${W / 2}" y="30" text-anchor="middle" class="title">${opts.title}</text>
  <text x="${W / 2}" y="50" text-anchor="middle" class="subtitle">${opts.subtitle}</text>

  <line x1="${chartLeft}" y1="${chartTop}" x2="${chartLeft}" y2="${chartBottom}" class="axis"/>
  <line x1="${chartLeft}" y1="${chartBottom}" x2="${chartRight}" y2="${chartBottom}" class="axis"/>
  `;

  // Threshold line
  if (opts.threshold) {
    const tx = chartLeft + (opts.threshold.value / opts.maxValue) * chartWidth;
    content += `
  <line x1="${tx}" y1="${chartTop - 10}" x2="${tx}" y2="${chartBottom}" class="threshold"/>
  <text x="${tx}" y="${chartTop - 14}" text-anchor="middle" class="threshold-label">${opts.threshold.label}</text>
    `;
  }

  // Bars
  opts.bars.forEach((bar, i) => {
    const y = chartTop + i * (barHeight + barGap) + barGap / 2;
    const w = (bar.value / opts.maxValue) * chartWidth;
    const display = bar.displayValue ?? `${bar.value.toLocaleString()} ${opts.unit}`;
    content += `
  <text x="${chartLeft - 10}" y="${y + barHeight / 2 + 4}" text-anchor="end" class="label">${bar.label}</text>
  <rect x="${chartLeft}" y="${y}" width="${w}" height="${barHeight}" class="${bar.className}"/>
  <text x="${chartLeft + w + 8}" y="${y + barHeight / 2 + 4}" class="label" font-weight="bold">${display}</text>
    `;
  });

  // X axis labels
  const ticks = 5;
  for (let i = 0; i <= ticks; i++) {
    const value = (opts.maxValue / ticks) * i;
    const x = chartLeft + (value / opts.maxValue) * chartWidth;
    content += `
  <line x1="${x}" y1="${chartBottom}" x2="${x}" y2="${chartBottom + 5}" class="axis"/>
  <text x="${x}" y="${chartBottom + 18}" text-anchor="middle" class="label-small">${value >= 1000 ? Math.round(value / 1000) + "k" : value.toFixed(0)}</text>
    `;
  }

  content += `
  <text x="${(chartLeft + chartRight) / 2}" y="${chartBottom + 38}" text-anchor="middle" class="label">${opts.unit}</text>
  <text x="${W / 2}" y="${H - 15}" text-anchor="middle" class="label-small" font-style="italic">Maquina: Intel i5-12500H, 32 GB RAM, Win 11 | Mediana de 5 iteracoes</text>
  `;

  return svgWrap(W, H, content);
}

// ─── Diagrama: Fluxo de execucao da transferencia ──────────────────────────

function generateFlowSVG(): string {
  const W = 920;
  const H = 520;
  const x = 160;
  const w = 600;
  const tx = 180;

  function box(y: number, h: number, kind: string, title: string, lines: string[]): string {
    const fill = kind === "off" ? "#fef3c7" : "#eef4fb";
    const stroke = kind === "off" ? "#d97706" : "#1f3a5f";
    let t = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="8" ry="8" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
    t += `<text x="${tx}" y="${y + 22}" font-size="12" font-weight="bold" fill="#1a1a1a">${title}</text>`;
    lines.forEach((ln, i) => {
      t += `<text x="${tx}" y="${y + 44 + i * 19}" font-size="11" fill="#333">${ln}</text>`;
    });
    return t;
  }
  function arrow(y1: number, y2: number): string {
    return `<line x1="460" y1="${y1}" x2="460" y2="${y2}" class="arrow"/>`;
  }

  const content = `
  <text x="460" y="32" text-anchor="middle" class="title">Fluxo de execucao da transferencia (entrega contra pagamento)</text>
  <text x="460" y="52" text-anchor="middle" class="subtitle">Amarelo: fora da cadeia (cliente / regulador)   |   Azul: na cadeia (Hyperledger Besu, QBFT)</text>
  ${box(72, 92, "off", "Momento 0 - Cliente (fora da cadeia)", [
    "Calcula os compromissos Poseidon do saldo",
    "Gera a prova Groth16 (valida a operacao sem revelar valores)",
    "Cifra os dados de auditoria com ECIES para o regulador",
  ])}
  ${arrow(164, 184)}
  ${box(184, 50, "on", "Momento 1 - Registro inicial: mint (PrivateToken)", [
    "Grava os compromissos iniciais na cadeia (apenas hashes)",
  ])}
  ${arrow(234, 254)}
  ${box(254, 150, "on", "Momento 2 - executeDvP: transacao atomica (DvPSettlement)", [
    "1. Verifier valida a prova on-chain (precompileds BN128)",
    "2. Confere se os compromissos atuais batem com a prova",
    "3. Atualiza os compromissos: a transferencia se efetiva",
    "4. RegulatorViewer armazena o blob cifrado (ECIES)",
    "5. Emite eventos, sem expor valores",
  ])}
  ${arrow(404, 424)}
  ${box(424, 72, "off", "Momento 3 - Auditoria: regulador (fora da cadeia)", [
    "accessEncryptedTx emite o evento RegulatorAccessed (trilha)",
    "Decifra o blob com a chave privada e obtem os valores reais",
  ])}`;

  return svgWrap(W, H, content);
}

// ─── Main ────────────────────────────────────────────────────────────────────

function main(): void {
  fs.mkdirSync(OUT_DIR, { recursive: true });

  // 1. Arquitetura
  fs.writeFileSync(path.join(OUT_DIR, "architecture.svg"), generateArchitectureSVG());
  console.log("Generated: architecture.svg");

  // 2. Sequencia
  fs.writeFileSync(path.join(OUT_DIR, "dvp_sequence.svg"), generateSequenceSVG());
  console.log("Generated: dvp_sequence.svg");

  // 3. Tempo de prova
  fs.writeFileSync(
    path.join(OUT_DIR, "benchmark_proof_time.svg"),
    generateBarChartSVG({
      title: "Tempo de geracao de prova off-chain",
      subtitle: "RNF01: total < 30s | medido: 1.93s (15x melhor)",
      bars: [
        { label: "compute-witness", value: 869, className: "bar-info" },
        { label: "generate-proof", value: 1064, className: "bar-info" },
        { label: "TOTAL off-chain", value: 1933, className: "bar-good", displayValue: "1.93s" },
      ],
      maxValue: 30000,
      threshold: { value: 30000, label: "RNF01: 30s" },
      unit: "ms",
    })
  );
  console.log("Generated: benchmark_proof_time.svg");

  // 4. Gas
  fs.writeFileSync(
    path.join(OUT_DIR, "benchmark_gas.svg"),
    generateBarChartSVG({
      title: "Gas consumido on-chain",
      subtitle: "RNF02: verifyTx < 300k | medido: 264.020 (12% folga)",
      bars: [
        { label: "verifyTx (so verify)", value: 264020, className: "bar-good" },
        { label: "executeDvP completo", value: 503858, className: "bar-warn" },
      ],
      maxValue: 600000,
      threshold: { value: 300000, label: "RNF02: 300k" },
      unit: "gas",
    })
  );
  console.log("Generated: benchmark_gas.svg");

  // 5. Constraints e prova
  fs.writeFileSync(
    path.join(OUT_DIR, "benchmark_constraints.svg"),
    generateBarChartSVG({
      title: "Caracteristicas do circuito Groth16",
      subtitle: "1.728 constraints, 256 bytes de prova",
      bars: [
        { label: "Constraints", value: 1728, className: "bar-info", displayValue: "1.728 constraints" },
        { label: "Tamanho da prova", value: 256, className: "bar-info", displayValue: "256 bytes" },
        { label: "Public inputs", value: 4, className: "bar-info", displayValue: "4 inputs (commits)" },
        { label: "Iteracoes do benchmark", value: 5, className: "bar-neutral", displayValue: "5 (mediana)" },
      ],
      maxValue: 2000,
      unit: "(escala mista)",
    })
  );
  console.log("Generated: benchmark_constraints.svg");

  // 6. Fluxo de execucao da transferencia
  fs.writeFileSync(path.join(OUT_DIR, "transfer_flow.svg"), generateFlowSVG());
  console.log("Generated: transfer_flow.svg");

  console.log("\nTodos os SVGs gerados em " + OUT_DIR);
}

main();
