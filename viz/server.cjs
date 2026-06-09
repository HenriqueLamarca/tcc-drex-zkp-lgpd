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
const { spawn } = require("child_process");
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SENTINEL = path.join(ROOT, ".make_step.ok");
const PORT = 4173;

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
  benchmark: { script: "benchmark", label: "Benchmark" },
};

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

    send(null, { line: `$ npm run ${t.script}` });

    const child = spawn(`npm run ${t.script}`, {
      cwd: ROOT,
      shell: true,
      env: { ...process.env, BESU_PRIVATE_KEYS: BESU_KEYS },
    });

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
});
