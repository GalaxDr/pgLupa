import { Pool, types } from "pg";
import { config } from "./config";

// numeric e bigint chegam como string por padrão; para os valores usados pela
// ferramenta (durações em ms, contagens) a precisão de number é suficiente.
// Atenção: query_id (64 bits) excede essa precisão e deve ser lido como texto (query_id::text).
types.setTypeParser(types.builtins.NUMERIC, (v) => Number(v));
types.setTypeParser(types.builtins.INT8, (v) => Number(v));

const globalParaPool = globalThis as unknown as { __sqmPool?: Pool };

/** Conjunto de conexões com o banco de dados da ferramenta, compartilhado pela aplicação web e pelo coletor. */
export function pool(): Pool {
  if (!globalParaPool.__sqmPool) {
    const connectionString = config.bancoFerramenta;
    const p = new Pool({ connectionString, max: 10, connectionTimeoutMillis: 10_000, idleTimeoutMillis: 30_000 });
    // conexões ociosas perdidas (ex.: reinício do banco) não devem encerrar o processo
    p.on("error", (e) => console.error("conexão com o banco da ferramenta perdida:", e.message));
    globalParaPool.__sqmPool = p;
  }
  return globalParaPool.__sqmPool;
}
