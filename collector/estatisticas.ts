import { Client } from "pg";
import { pool } from "../src/lib/db";

const LIMITE_CONSULTAS = 500;

/** Estatísticas agregadas por query_id, das consultas com maior tempo total. */
const SQL_PG_STAT_STATEMENTS = `SELECT queryid::text AS query_id,
         sum(calls)::bigint AS calls,
         sum(total_exec_time) AS total_exec_time,
         sum(total_exec_time) / NULLIF(sum(calls), 0) AS mean_exec_time,
         sum(rows)::bigint AS rows,
         sum(shared_blks_hit)::bigint AS shared_blks_hit,
         sum(shared_blks_read)::bigint AS shared_blks_read
  FROM pg_stat_statements
  WHERE queryid IS NOT NULL
  GROUP BY queryid
  ORDER BY sum(total_exec_time) DESC
  LIMIT $1`;

/**
 * Registra um snapshot do pg_stat_statements do servidor monitorado. Os valores são
 * acumulados desde a última reinicialização das estatísticas; a variação entre dois
 * snapshots indica o que ocorreu no intervalo. Apenas as consultas com maior tempo
 * total de execução são registradas, para limitar o volume armazenado.
 */
export async function registrarSnapshot(servidorId: number, conexao: string): Promise<number> {
  const monitorado = new Client({ connectionString: conexao, application_name: "slowquery-monitor" });
  await monitorado.connect();
  try {
    const { rows } = await monitorado.query(SQL_PG_STAT_STATEMENTS, [LIMITE_CONSULTAS]);
    if (rows.length === 0) return 0;
    await pool().query(
      `INSERT INTO snapshot_estatistica
         (servidor_id, coletado_em, query_id, calls, total_exec_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read)
       SELECT $1, now(), t.query_id, t.calls, t.total, COALESCE(t.media, 0), t.linhas, t.hit, t.lidos
       FROM unnest($2::bigint[], $3::bigint[], $4::float8[], $5::float8[], $6::bigint[], $7::bigint[], $8::bigint[])
         AS t(query_id, calls, total, media, linhas, hit, lidos)`,
      [
        servidorId,
        rows.map((r) => r.query_id),
        rows.map((r) => r.calls),
        rows.map((r) => r.total_exec_time),
        rows.map((r) => r.mean_exec_time),
        rows.map((r) => r.rows),
        rows.map((r) => r.shared_blks_hit),
        rows.map((r) => r.shared_blks_read),
      ],
    );
    return rows.length;
  } finally {
    await monitorado.end();
  }
}
