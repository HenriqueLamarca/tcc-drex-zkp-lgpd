// =============================================================================
// _shutdown.ts — Saída limpa do processo no Windows.
//
// Os scripts hardhat precisam encerrar explicitamente porque o provider mantém
// o event loop vivo (polling/sockets HTTP). Chamar process.exit() diretamente
// dispara, no Windows, o crash de teardown do libuv:
//   Assertion failed: !(handle->flags & UV_HANDLE_CLOSING), file src\win\async.c
// porque o exit corre com um handle ainda em fechamento.
//
// Solução: encerrar o provider (fecha polling/sockets), deixar o event loop
// drenar e o Node sair naturalmente com o código desejado — sem process.exit,
// sem corrida de teardown. Um timer unref'd é apenas rede de segurança caso
// algum handle externo persista (não segura o loop sozinho).
// =============================================================================

import { ethers } from "hardhat";

export function shutdown(code: number): void {
  try {
    (ethers.provider as unknown as { destroy?: () => void }).destroy?.();
  } catch {
    /* provider sem destroy() — segue para a saída natural/fallback */
  }
  process.exitCode = code;
  // Rede de segurança: se algum handle ainda segurar o loop, força a saída.
  setTimeout(() => process.exit(code), 2000).unref();
}
