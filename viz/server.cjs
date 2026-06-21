// =============================================================================
// viz/server.cjs - Painel visual da PoC DREX-ZKP-LGPD.
//
// Servidor HTTP minimo (sem dependencias externas) que dispara os MESMOS
// scripts reais do projeto (deploy, demo, demo:fail, benchmark) e transmite a
// saida ao vivo para o navegador via Server-Sent Events (SSE). O sucesso e'
// detectado pelo mesmo sentinela .make_step.ok usado pelo Makefile, tolerando
// o crash de teardown do libuv no Windows.
//
// Uso:  npm run viz   (ou: node viz/server.cjs)  ->  http://localhost:4173
// =============================================================================

const http = require("http");
const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SENTINEL = path.join(ROOT, ".make_step.ok");
const PORT = Number(process.env.VIZ_PORT) || 4173;

// As redes besu (deploy, demo, demo:fail) exigem BESU_PRIVATE_KEYS. O Makefile
// exporta essa variavel; como aqui chamamos os scripts npm diretamente, nos
// mesmos as fornecemos. Ordem: (1) variavel de ambiente, se o usuario exportou;
// (2) leitura do proprio Makefile; (3) fallback embutido (mesmas chaves de
// teste publicas e documentadas — exclusivas da rede local, nunca em producao).
const BESU_KEYS_FALLBACK = [
  "0x8f2a55949038a9610f50fb23b5883af3b4ecb3c3bb792cbcefbd1542c692be63",
  "0xc87509a1c067bbde78beb793e6fa76530b6382a4c0241e5e4a9ec0a0f44dc0d3",
  "0xae6ae8e5ccbfb04590405997ee2d52d2b330726137b875053c36d94e974d162f",
  "0xdbda1821b80551c9d65939329250298aa3472ba22feea921c0cf5d620ea67b97",
].join(",");

function loadBesuKeys() {
  if (process.env.BESU_PRIVATE_KEYS) return process.env.BESU_PRIVATE_KEYS;
  try {
    const mk = fs.readFileSync(path.join(ROOT, "Makefile"), "utf-8");
    const m = mk.match(/BESU_PRIVATE_KEYS\s*:=\s*(\S+)/);
    if (m && m[1].includes("0x")) return m[1];
  } catch (_e) {
    /* sem Makefile legivel — usa o fallback embutido */
  }
  return BESU_KEYS_FALLBACK;
}
const BESU_KEYS = loadBesuKeys();

// Alvos permitidos (whitelist — sem entrada arbitraria do usuario).
const TARGETS = {
  deploy: { script: "deploy", label: "Deploy dos contratos" },
  demo: { script: "dvp:demo", label: "Liquidacao valida (sucesso)" },
  "demo-fail": { script: "dvp:demo:fail", label: "Liquidacao invalida (rejeicao)" },
  "demo-value": { interactive: true, label: "Liquidacao com valor escolhido" },
  benchmark: { script: "benchmark", label: "Benchmark" },
  onchain: { script: "onchain", label: "Estado on-chain (privacidade)" },
  insolvent: { bash: "scripts/circuit_insolvent.sh", label: "Tentativa sem saldo (circuito recusa)" },
};

// Caminho do Git Bash no Windows (mesmo do Makefile); fora dele, usa 'bash'.
const BASH_BIN = process.platform === "win32" ? "C:/PROGRA~1/Git/bin/bash.exe" : "bash";

function stripAnsi(s) {
  // eslint-disable-next-line no-control-regex
  return s.replace(/\x1b\[[0-9;]*m/g, "");
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    fs.createReadStream(path.join(__dirname, "index.html")).pipe(res);
    return;
  }

  // Saldos correntes do livro-razao da liquidacao interativa (placar do painel).
  // Le .dvp_state ("FROM_C FROM_R TO_C TO_R" em centavos); sem arquivo => inicial.
  if (url.pathname === "/state") {
    let from = "100.00";
    let to = "50.00";
    try {
      const raw = fs.readFileSync(path.join(ROOT, ".dvp_state"), "utf-8").trim();
      const parts = raw.split(/\s+/);
      const fmt = (c) => (Number(c) / 100).toFixed(2);
      if (parts[0] && parts[2]) {
        from = fmt(parts[0]);
        to = fmt(parts[2]);
      }
    } catch (_e) {
      /* sem estado salvo - usa o inicial 100/50 */
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ from, to }));
    return;
  }

  if (url.pathname === "/run") {
    const target = url.searchParams.get("target");
    const t = TARGETS[target];
    if (!t) {
      res.writeHead(400, { "Content-Type": "text/plain" });
      res.end("alvo invalido");
      return;
    }

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    const send = (event, data) => {
      if (event) res.write(`event: ${event}\n`);
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    try {
      fs.unlinkSync(SENTINEL);
    } catch (_e) {
      /* sentinela pode nao existir — ok */
    }

    // Monta o comando conforme o alvo. No painel, as liquidações rodam em modo
    // compacto: cada resultado vira um quadro auto-contido (comprovante, trilha
    // de auditoria, rejeição), ideal para uma única captura de tela.
    const env = { ...process.env, BESU_PRIVATE_KEYS: BESU_KEYS };
    let cmd;
    if (target === "demo-value") {
      // DvP interativo: o valor da transação vem do painel. Validação estrita
      // (apenas dígitos) — o valor segue por variável de ambiente, nunca
      // concatenado no comando, evitando injeção de shell.
      const value = (url.searchParams.get("value") || "").trim();
      if (!/^\d{1,7}(\.\d{1,2})?$/.test(value)) {
        send(null, { line: "[dvp] Valor invalido: informe um numero positivo (ate 2 casas)." });
        send("done", { success: false, target, label: t.label });
        res.end();
        return;
      }
      env.DVP_VALUE = value;
      env.DEMO_COMPACT = "1";
      cmd = `"${BASH_BIN}" scripts/run_dvp_value.sh`;
      send(null, { line: `$ DVP_VALUE=${value} bash scripts/run_dvp_value.sh` });
    } else if (t.bash) {
      // Alvos que rodam um script bash direto (ex.: recusa de solvencia no circuito).
      env.DEMO_COMPACT = "1";
      cmd = `"${BASH_BIN}" ${t.bash}`;
      send(null, { line: `$ bash ${t.bash}` });
    } else {
      if (target === "demo" || target === "demo-fail" || target === "onchain") {
        env.DEMO_COMPACT = "1";
      }
      cmd = `npm run ${t.script}`;
      send(null, { line: `$ npm run ${t.script}` });
    }

    const child = spawn(cmd, { cwd: ROOT, shell: true, env });

    const onData = (buf) => {
      const text = stripAnsi(buf.toString("utf-8"));
      for (const line of text.split(/\r?\n/)) send(null, { line });
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);

    child.on("close", () => {
      let success = false;
      try {
        fs.accessSync(SENTINEL);
        success = true;
        fs.unlinkSync(SENTINEL);
      } catch (_e) {
        /* sem sentinela = falha real */
      }
      send("done", { success, target, label: t.label });
      res.end();
    });

    req.on("close", () => {
      try {
        child.kill();
      } catch (_e) {
        /* processo ja' encerrado */
      }
    });
    return;
  }

  res.writeHead(404, { "Content-Type": "text/plain" });
  res.end("nao encontrado");
});

server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    console.error("");
    console.error(`  [viz] A porta ${PORT} já está em uso.`);
    console.error("  Provavelmente há um painel antigo aberto. Encerre-o (Ctrl+C na");
    console.error("  janela onde ele roda) e rode 'make viz' de novo, ou apenas");
    console.error(`  abra http://localhost:${PORT} se o painel ja' estiver no ar.`);
    console.error("");
    process.exit(1);
  }
  throw err;
});

// Encerramento limpo (Ctrl+C). Quando o painel é aberto por `make viz:up`
// (que sobe a rede), a variável VIZ_DOWN_ON_EXIT=1 faz com que o Ctrl+C
// também derrube a rede Besu. Aberto por `make viz` (rede já no ar e gerida
// à parte), apenas encerra o painel e deixa a rede de pé.
let encerrando = false;
function encerrar(sinal) {
  if (encerrando) return;
  encerrando = true;
  if (process.env.VIZ_DOWN_ON_EXIT === "1") {
    console.log(`\n  [viz] Encerrando (${sinal}) — derrubando a rede Besu...`);
    try {
      execSync(`docker compose -f ${path.join(ROOT, "besu-network", "docker-compose.yml")} down`, {
        cwd: ROOT,
        stdio: "inherit",
      });
      console.log("  [viz] Rede Besu encerrada.");
    } catch (_e) {
      console.error("  [viz] Falha ao derrubar a rede — rode 'make besu:down' manualmente.");
    }
  } else {
    console.log(`\n  [viz] Painel encerrado (${sinal}). A rede Besu continua no ar (use 'make besu:down').`);
  }
  process.exit(0);
}
for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) {
  try {
    process.on(sig, () => encerrar(sig));
  } catch (_e) {
    /* sinal indisponível na plataforma — ignora */
  }
}

server.listen(PORT, "127.0.0.1", () => {
  const urlStr = `http://localhost:${PORT}`;
  console.log("");
  console.log("  ┌────────────────────────────────────────────────┐");
  console.log("  │  Painel visual — PoC DREX-ZKP-LGPD               │");
  console.log("  └────────────────────────────────────────────────┘");
  console.log(`  Abra no navegador:  ${urlStr}`);
  const nKeys = BESU_KEYS ? BESU_KEYS.split(",").filter((k) => k.includes("0x")).length : 0;
  console.log(`  Chaves Besu carregadas: ${nKeys} (necessario para deploy/demo)`);
  console.log("  (Ctrl+C para encerrar)");
  console.log("");
  // Abre o navegador automaticamente (best-effort, multiplataforma).
  // VIZ_NO_OPEN=1 desativa (uso headless/automatizado).
  if (process.env.VIZ_NO_OPEN !== "1") {
    const opener =
      process.platform === "win32"
        ? `start "" ${urlStr}`
        : process.platform === "darwin"
          ? `open ${urlStr}`
          : `xdg-open ${urlStr}`;
    try {
      spawn(opener, { shell: true, stdio: "ignore", detached: true });
    } catch (_e) {
      /* sem navegador automatico — usuario abre manualmente */
    }
  }
});
