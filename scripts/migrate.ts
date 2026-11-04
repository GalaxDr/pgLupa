import { pool } from "../src/lib/db";
import { executarMigracoes } from "../src/lib/migracoes";

/** Aguarda o banco aceitar conexões (o Docker pode levar alguns segundos para liberar a porta). */
async function aguardarBanco(tentativas = 20) {
  for (let i = 1; ; i++) {
    try {
      await pool().query("SELECT 1");
      return;
    } catch (e) {
      if (i >= tentativas) throw e;
      console.log(`banco da ferramenta ainda indisponível (${(e as Error).message}); nova tentativa em 3 s...`);
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}

async function main() {
  await aguardarBanco();
  await executarMigracoes();
  console.log("banco da ferramenta atualizado");
  await pool().end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
