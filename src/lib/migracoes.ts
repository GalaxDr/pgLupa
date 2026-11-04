import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { pool } from "./db";

/** Aplica, em ordem, os arquivos de db/migrations ainda não aplicados. */
export async function executarMigracoes(log: (m: string) => void = console.log): Promise<void> {
  const db = pool();
  await db.query(`CREATE TABLE IF NOT EXISTS schema_migracao (
    nome text PRIMARY KEY,
    aplicada_em timestamptz NOT NULL DEFAULT now()
  )`);
  const dir = path.join(/*turbopackIgnore: true*/ process.cwd(), "db", "migrations");
  const arquivos = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  const { rows } = await db.query<{ nome: string }>("SELECT nome FROM schema_migracao");
  const aplicadas = new Set(rows.map((r) => r.nome));

  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = readFileSync(path.join(dir, arquivo), "utf8");
    const client = await db.connect();
    try {
      await client.query("BEGIN");
      // impede que duas instâncias apliquem a mesma migração ao mesmo tempo
      await client.query("SELECT pg_advisory_xact_lock(727501)");
      const { rowCount } = await client.query("SELECT 1 FROM schema_migracao WHERE nome = $1", [arquivo]);
      if (!rowCount) {
        await client.query(sql);
        await client.query("INSERT INTO schema_migracao (nome) VALUES ($1)", [arquivo]);
        log(`aplicada: ${arquivo}`);
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }
}
