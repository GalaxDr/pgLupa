import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";
import type { PoolClient } from "pg";
import { pool } from "../src/lib/db";
import { normalizarSql } from "../src/lib/normalizar";
import { aplicarParametros, interpretarMensagem } from "./mensagem";
import { interpretarCsvlog, interpretarJsonlog } from "./parsers";
import type { FormatoLog, RegistroLog } from "./tipos";

export interface Servidor {
  id: number;
  nome: string;
  diretorio_logs: string;
  formato_log: FormatoLog;
  /** grava o texto normalizado no lugar do texto executado, sem os valores das consultas */
  anonimizar?: boolean;
}

// quantidade de bytes lidos do arquivo por transação (padrão 1 MB)
const TAMANHO_BLOCO = Math.max(64, Number(process.env.BLOCO_LEITURA_KB ?? 1024)) * 1024;
const EXTENSAO: Record<FormatoLog, string> = { csvlog: ".csv", jsonlog: ".json" };

/** Lê o conteúdo novo de todos os arquivos de log do servidor. Retorna o número de ocorrências gravadas. */
export async function lerServidor(servidor: Servidor): Promise<number> {
  const dir = path.resolve(servidor.diretorio_logs);
  let nomes: string[];
  try {
    nomes = (await readdir(dir)).filter((f) => f.endsWith(EXTENSAO[servidor.formato_log]));
  } catch (e) {
    console.warn(`[${servidor.nome}] não foi possível listar ${dir}: ${(e as Error).message}`);
    return 0;
  }

  // processa do arquivo modificado há mais tempo para o mais recente
  const arquivos = await Promise.all(
    nomes.map(async (nome) => ({ nome, info: await stat(path.join(dir, nome)) })),
  );
  arquivos.sort((a, b) => a.info.mtimeMs - b.info.mtimeMs);

  let total = 0;
  for (const { nome, info } of arquivos) {
    total += await lerArquivo(servidor, path.join(dir, nome), nome, info.size);
  }
  return total;
}

async function lerArquivo(servidor: Servidor, caminho: string, nome: string, tamanho: number): Promise<number> {
  const db = pool();
  const { rows } = await db.query<{ id: number; posicao_lida: number }>(
    `INSERT INTO arquivo_log (servidor_id, nome_arquivo) VALUES ($1, $2)
     ON CONFLICT (servidor_id, nome_arquivo) DO UPDATE SET nome_arquivo = EXCLUDED.nome_arquivo
     RETURNING id, posicao_lida`,
    [servidor.id, nome],
  );
  const arquivo = rows[0];
  let posicao = arquivo.posicao_lida;

  // arquivo menor que a posição já lida: foi truncado na rotação (log_truncate_on_rotation)
  if (tamanho < posicao) {
    console.log(`[${servidor.nome}] ${nome} foi reiniciado; lendo desde o início`);
    posicao = 0;
    await db.query("UPDATE arquivo_log SET posicao_lida = 0, tamanho = $2, atualizado_em = now() WHERE id = $1", [arquivo.id, tamanho]);
  }
  if (tamanho === posicao) return 0;

  const interpretar = servidor.formato_log === "csvlog" ? interpretarCsvlog : interpretarJsonlog;
  const fd = await open(caminho, "r");
  let gravadas = 0;
  try {
    let bloco = TAMANHO_BLOCO;
    while (posicao < tamanho) {
      const len = Math.min(bloco, tamanho - posicao);
      const buf = Buffer.alloc(len);
      const { bytesRead } = await fd.read(buf, 0, len, posicao);
      const { registros, bytesConsumidos } = interpretar(buf.subarray(0, bytesRead).toString("utf8"));

      if (bytesConsumidos === 0) {
        // registro maior que o bloco: amplia a leitura; se já chegou ao fim, aguarda o registro ser concluído
        if (posicao + len >= tamanho) break;
        bloco *= 2;
        continue;
      }
      bloco = TAMANHO_BLOCO;

      const client = await db.connect();
      try {
        await client.query("BEGIN");
        gravadas += await gravarOcorrencias(client, servidor.id, registros, servidor.anonimizar ?? false);
        posicao += bytesConsumidos;
        await client.query(
          "UPDATE arquivo_log SET posicao_lida = $2, tamanho = $3, atualizado_em = now() WHERE id = $1",
          [arquivo.id, posicao, tamanho],
        );
        await client.query("COMMIT");
      } catch (e) {
        await client.query("ROLLBACK");
        throw e;
      } finally {
        client.release();
      }
    }
  } finally {
    await fd.close();
  }
  return gravadas;
}

interface Ocorrencia {
  fingerprint: string;
  textoNormalizado: string;
  queryId: string | null;
  registro: RegistroLog;
  duracaoMs: number;
  textoExecutado: string;
}

/**
 * Converte os registros de consultas lentas em ocorrências e os grava, junto com a
 * consulta normalizada correspondente, na mesma transação que atualiza a posição de leitura.
 */
async function gravarOcorrencias(client: PoolClient, servidorId: number, registros: RegistroLog[], anonimizar: boolean): Promise<number> {
  const ocorrencias: Ocorrencia[] = [];
  for (const r of registros) {
    if (r.severidade && r.severidade !== "LOG") continue;
    const c = interpretarMensagem(r.mensagem);
    if (!c) continue;
    const { texto, fingerprint } = normalizarSql(c.sql);
    ocorrencias.push({
      fingerprint,
      textoNormalizado: texto,
      queryId: r.queryId,
      registro: r,
      duracaoMs: c.duracaoMs,
      textoExecutado: c.etapa === "execute" ? aplicarParametros(c.sql, r.detalhe) : c.sql,
    });
  }
  if (ocorrencias.length === 0) return 0;

  // consultas normalizadas: uma linha por fingerprint, com o período em que apareceram neste bloco
  const porFingerprint = new Map<string, Ocorrencia[]>();
  for (const o of ocorrencias) {
    const lista = porFingerprint.get(o.fingerprint) ?? [];
    lista.push(o);
    porFingerprint.set(o.fingerprint, lista);
  }
  const fps = [...porFingerprint.keys()];
  const { rows } = await client.query<{ id: number; fingerprint: string }>(
    `WITH entrada AS (
       SELECT t.fingerprint, t.texto, t.query_id, t.data_hora::timestamptz AS data_hora
       FROM unnest($1::text[], $2::text[], $3::bigint[], $4::text[]) AS t(fingerprint, texto, query_id, data_hora)
     ), agrupada AS (
       SELECT fingerprint, min(texto) AS texto, max(query_id) AS query_id,
              min(data_hora) AS primeira, max(data_hora) AS ultima
       FROM entrada GROUP BY fingerprint
     )
     INSERT INTO consulta (fingerprint, texto_normalizado, query_id, primeira_ocorrencia, ultima_ocorrencia)
     SELECT fingerprint, texto, query_id, primeira, ultima FROM agrupada
     ON CONFLICT (fingerprint) DO UPDATE SET
       query_id = COALESCE(EXCLUDED.query_id, consulta.query_id),
       primeira_ocorrencia = LEAST(consulta.primeira_ocorrencia, EXCLUDED.primeira_ocorrencia),
       ultima_ocorrencia = GREATEST(consulta.ultima_ocorrencia, EXCLUDED.ultima_ocorrencia)
     RETURNING id, fingerprint`,
    [
      ocorrencias.map((o) => o.fingerprint),
      ocorrencias.map((o) => o.textoNormalizado),
      ocorrencias.map((o) => o.queryId),
      ocorrencias.map((o) => o.registro.dataHora),
    ],
  );
  const idPorFingerprint = new Map(rows.map((r) => [r.fingerprint, r.id]));
  if (idPorFingerprint.size !== fps.length) throw new Error("falha ao registrar consultas normalizadas");

  await client.query(
    `INSERT INTO ocorrencia (consulta_id, servidor_id, data_hora, duracao_ms, banco, usuario, aplicacao, host_cliente, pid, texto_executado)
     SELECT t.consulta_id, $1, t.data_hora::timestamptz, t.duracao_ms, t.banco, t.usuario, t.aplicacao, t.host_cliente, t.pid, t.texto
     FROM unnest($2::bigint[], $3::text[], $4::numeric[], $5::text[], $6::text[], $7::text[], $8::text[], $9::int[], $10::text[])
       AS t(consulta_id, data_hora, duracao_ms, banco, usuario, aplicacao, host_cliente, pid, texto)`,
    [
      servidorId,
      ocorrencias.map((o) => idPorFingerprint.get(o.fingerprint)),
      ocorrencias.map((o) => o.registro.dataHora),
      ocorrencias.map((o) => o.duracaoMs),
      ocorrencias.map((o) => o.registro.banco),
      ocorrencias.map((o) => o.registro.usuario),
      ocorrencias.map((o) => o.registro.aplicacao),
      ocorrencias.map((o) => o.registro.hostCliente),
      ocorrencias.map((o) => o.registro.pid),
      ocorrencias.map((o) => (anonimizar ? o.textoNormalizado : o.textoExecutado)),
    ],
  );
  return ocorrencias.length;
}
