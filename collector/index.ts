/**
 * Coletor: processo independente da aplicação web que acompanha continuamente os
 * arquivos de log dos servidores monitorados e grava as ocorrências no banco da ferramenta.
 *
 *   npm run collector
 */
import os from "node:os";
import { pool } from "../src/lib/db";
import { registrarSnapshot } from "./estatisticas";
import { lerServidor, type Servidor } from "./leitura";

const INTERVALO_LEITURA = Number(process.env.INTERVALO_LEITURA_MS ?? 2000);
const INTERVALO_SNAPSHOT = Number(process.env.INTERVALO_SNAPSHOT_MS ?? 60000);
const RETENCAO_DIAS = Number(process.env.RETENCAO_DIAS ?? 30);

let encerrando = false;
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Cadastra (ou atualiza) o servidor definido nas variáveis de ambiente. */
async function registrarServidorDoAmbiente(): Promise<void> {
  const nome = process.env.SERVIDOR_NOME;
  const dir = process.env.LOG_DIR;
  if (!nome || !dir) return;
  const formato = process.env.LOG_FORMAT ?? "csvlog";
  await pool().query(
    `INSERT INTO servidor (nome, diretorio_logs, formato_log) VALUES ($1, $2, $3)
     ON CONFLICT (nome) DO UPDATE SET diretorio_logs = EXCLUDED.diretorio_logs, formato_log = EXCLUDED.formato_log`,
    [nome, dir, formato],
  );
}

async function servidoresAtivos(): Promise<Servidor[]> {
  const { rows } = await pool().query<Servidor>(
    "SELECT id, nome, diretorio_logs, formato_log FROM servidor WHERE ativo ORDER BY id",
  );
  // ANONIMIZAR_VALORES=true: não armazena os valores das consultas (apenas o texto normalizado)
  const anonimizar = process.env.ANONIMIZAR_VALORES === "true";
  return rows.map((s) => ({ ...s, anonimizar }));
}

async function cicloDeLeitura() {
  while (!encerrando) {
    try {
      for (const s of await servidoresAtivos()) {
        const n = await lerServidor(s);
        if (n > 0) console.log(`[${s.nome}] ${n} ocorrência(s) registrada(s)`);
      }
    } catch (e) {
      console.error("erro na leitura dos logs:", e);
    }
    await esperar(INTERVALO_LEITURA);
  }
}

async function cicloDeSnapshots() {
  const conexao = process.env.MONITORADO_URL;
  const nome = process.env.SERVIDOR_NOME;
  if (!conexao || !nome) {
    console.log("MONITORADO_URL não definida: snapshots do pg_stat_statements desativados");
    return;
  }
  while (!encerrando) {
    try {
      const { rows } = await pool().query<{ id: number }>("SELECT id FROM servidor WHERE nome = $1", [nome]);
      if (rows[0]) {
        const n = await registrarSnapshot(rows[0].id, conexao);
        console.log(`[${nome}] snapshot do pg_stat_statements com ${n} consulta(s)`);
      }
    } catch (e) {
      console.error("erro ao registrar snapshot do pg_stat_statements:", (e as Error).message);
    }
    await esperar(INTERVALO_SNAPSHOT);
  }
}

async function cicloDeRetencao() {
  if (!(RETENCAO_DIAS > 0)) return;
  while (!encerrando) {
    try {
      const o = await pool().query(
        "DELETE FROM ocorrencia WHERE data_hora < now() - make_interval(days => $1)",
        [RETENCAO_DIAS],
      );
      const s = await pool().query(
        "DELETE FROM snapshot_estatistica WHERE coletado_em < now() - make_interval(days => $1)",
        [RETENCAO_DIAS],
      );
      if ((o.rowCount ?? 0) + (s.rowCount ?? 0) > 0) {
        console.log(`retenção: ${o.rowCount} ocorrência(s) e ${s.rowCount} snapshot(s) removidos`);
      }
    } catch (e) {
      console.error("erro na retenção:", (e as Error).message);
    }
    await esperar(60 * 60 * 1000);
  }
}

async function main() {
  // prioridade reduzida, para não competir com o servidor monitorado quando executados na mesma máquina
  try {
    os.setPriority(Number(process.env.PRIORIDADE_COLETOR ?? 10));
  } catch {
    // sem permissão para alterar a prioridade: segue com a prioridade padrão
  }
  await registrarServidorDoAmbiente();
  const servidores = await servidoresAtivos();
  if (servidores.length === 0) {
    console.error("nenhum servidor ativo cadastrado; defina SERVIDOR_NOME e LOG_DIR no .env");
    process.exit(1);
  }
  for (const s of servidores) console.log(`monitorando ${s.nome}: ${s.diretorio_logs} (${s.formato_log})`);
  await Promise.all([cicloDeLeitura(), cicloDeSnapshots(), cicloDeRetencao()]);
  await pool().end();
}

for (const sinal of ["SIGINT", "SIGTERM"] as const) {
  process.on(sinal, () => {
    if (encerrando) process.exit(0);
    encerrando = true;
    console.log("encerrando o coletor...");
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
