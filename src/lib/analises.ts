import "server-only";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { lerServidor } from "../../collector/leitura";
import { pool } from "./db";

/** Modo hospedado: o site recebe arquivos de log por upload e as páginas globais ficam desativadas. */
export const modoHospedado = () => process.env.MODO === "hospedado";

const DIR_UPLOADS = () => path.resolve(/*turbopackIgnore: true*/ process.env.DIR_UPLOADS ?? path.join(os.tmpdir(), "sqm-uploads"));
export const LIMITE_UPLOAD_MB = () => Number(process.env.MAX_UPLOAD_MB ?? 1024);
export const RETENCAO_ANALISE_HORAS = () => Number(process.env.RETENCAO_ANALISE_HORAS ?? 72);

const RE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type Situacao = "recebendo" | "na_fila" | "processando" | "concluida" | "erro";

export interface Analise {
  id: string;
  servidor_id: number;
  nome_arquivo: string;
  formato_log: "csvlog" | "jsonlog";
  tamanho: number;
  situacao: Situacao;
  mensagem_erro: string | null;
  ocorrencias: number;
  criada_em: Date;
  concluida_em: Date | null;
  expira_em: Date;
  anonimizada: boolean;
  /** posição de leitura do arquivo, para indicar o progresso do processamento */
  posicao_lida: number | null;
}

export class ErroUpload extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

/** Nome exibido do arquivo, sem caminho e com tamanho limitado. */
function limparNome(nome: string): string {
  const base = nome.split(/[\\/]/).pop() ?? "log";
  return base.replace(/[^\w.\- ()]/g, "_").slice(0, 120) || "log";
}

export async function obterAnalise(id: string): Promise<Analise | null> {
  if (!RE_UUID.test(id)) return null;
  const { rows } = await pool().query<Analise>(
    `SELECT a.*, (SELECT max(posicao_lida) FROM arquivo_log l WHERE l.servidor_id = a.servidor_id) AS posicao_lida
     FROM analise a WHERE a.id = $1`,
    [id],
  );
  return rows[0] ?? null;
}

/**
 * Recebe o arquivo enviado, grava-o em disco e coloca a análise na fila de processamento.
 * Arquivos .gz são descompactados durante o recebimento.
 */
export async function receberUpload(
  nomeOriginal: string,
  corpo: Readable,
  tamanhoDeclarado: number | null,
  anonimizar = false,
): Promise<string> {
  const limite = LIMITE_UPLOAD_MB() * 1024 * 1024;
  if (tamanhoDeclarado !== null && tamanhoDeclarado > limite) {
    throw new ErroUpload(`O arquivo excede o limite de ${LIMITE_UPLOAD_MB()} MB.`, 413);
  }
  const nome = limparNome(nomeOriginal);
  const compactado = nome.toLowerCase().endsWith(".gz");
  const id = randomUUID();
  const dir = path.join(DIR_UPLOADS(), id);
  await mkdir(dir, { recursive: true });

  const db = pool();
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO servidor (nome, diretorio_logs, formato_log, ativo) VALUES ($1, $2, 'csvlog', false) RETURNING id`,
    [`analise-${id}`, dir],
  );
  await db.query(
    `INSERT INTO analise (id, servidor_id, nome_arquivo, formato_log, anonimizada, expira_em)
     VALUES ($1, $2, $3, 'csvlog', $5, now() + make_interval(hours => $4))`,
    [id, rows[0].id, nome, RETENCAO_ANALISE_HORAS(), anonimizar],
  );

  const temporario = path.join(dir, "recebendo.tmp");
  try {
    let recebidos = 0;
    let gravados = 0;
    const contarRecebidos = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        recebidos += chunk.length;
        if (recebidos > limite) cb(new ErroUpload(`O arquivo excede o limite de ${LIMITE_UPLOAD_MB()} MB.`, 413));
        else cb(null, chunk);
      },
    });
    const contarGravados = new Transform({
      transform(chunk: Buffer, _enc, cb) {
        gravados += chunk.length;
        // limite também para o conteúdo descompactado
        if (gravados > limite * 4) cb(new ErroUpload("O conteúdo descompactado é grande demais.", 413));
        else cb(null, chunk);
      },
    });
    const etapas = compactado
      ? [corpo, contarRecebidos, createGunzip(), contarGravados, createWriteStream(temporario)]
      : [corpo, contarRecebidos, contarGravados, createWriteStream(temporario)];
    // @ts-expect-error pipeline aceita uma lista variável de streams
    await pipeline(...etapas);
    if (gravados === 0) throw new ErroUpload("O arquivo está vazio.");

    // formato: jsonlog começa com "{"; caso contrário, csvlog
    const fd = await open(temporario, "r");
    const inicio = Buffer.alloc(64);
    await fd.read(inicio, 0, 64, 0);
    await fd.close();
    const formato = inicio.toString("utf8").replace(/^﻿/, "").trimStart().startsWith("{") ? "jsonlog" : "csvlog";
    await rename(temporario, path.join(dir, formato === "jsonlog" ? "log.json" : "log.csv"));

    await db.query("UPDATE servidor SET formato_log = $2 WHERE id = $1", [rows[0].id, formato]);
    await db.query("UPDATE analise SET formato_log = $2, tamanho = $3, situacao = 'na_fila' WHERE id = $1", [id, formato, gravados]);
  } catch (e) {
    await rm(dir, { recursive: true, force: true });
    await db.query("DELETE FROM servidor WHERE id = $1", [rows[0].id]);
    throw e;
  }
  enfileirar(id);
  return id;
}

// ------------------------------------------------------------ fila de processamento

const estado = globalThis as unknown as { __sqmFila?: Promise<void> };

/**
 * Executa as tarefas uma de cada vez: o processamento das análises (limitando o uso de CPU e
 * memória) e a limpeza das expiradas (evitando remover uma consulta que está sendo registrada).
 */
function naFila(tarefa: () => Promise<void>) {
  const anterior = estado.__sqmFila ?? Promise.resolve();
  estado.__sqmFila = anterior.then(tarefa).catch((e) => console.error("erro na fila de análises:", e));
}

const enfileirar = (id: string) => naFila(() => processar(id));

async function processar(id: string) {
  const db = pool();
  const a = await obterAnalise(id);
  if (!a || a.situacao === "concluida") return;
  const { rows } = await db.query("SELECT id, nome, diretorio_logs, formato_log FROM servidor WHERE id = $1", [a.servidor_id]);
  const servidor = rows[0];
  try {
    await db.query("UPDATE analise SET situacao = 'processando' WHERE id = $1", [id]);
    const ocorrencias = await lerServidor({ ...servidor, anonimizar: a.anonimizada });
    await db.query(
      "UPDATE analise SET situacao = 'concluida', ocorrencias = $2, concluida_em = now() WHERE id = $1",
      [id, ocorrencias],
    );
  } catch (e) {
    console.error(`erro ao processar a análise ${id}:`, e);
    await db.query("UPDATE analise SET situacao = 'erro', mensagem_erro = $2 WHERE id = $1", [
      id,
      "Não foi possível processar o arquivo. Verifique se ele está no formato csvlog ou jsonlog do PostgreSQL.",
    ]);
  } finally {
    // o arquivo original não é mantido após o processamento
    await rm(servidor.diretorio_logs, { recursive: true, force: true });
  }
}

// ------------------------------------------------------------ manutenção

/** Retoma análises interrompidas por um reinício do servidor e descarta envios incompletos. */
export async function retomarAnalises() {
  const db = pool();
  await db.query(
    `DELETE FROM servidor WHERE id IN (SELECT servidor_id FROM analise WHERE situacao = 'recebendo')`,
  );
  const { rows } = await db.query<{ id: string }>(
    "SELECT id FROM analise WHERE situacao IN ('na_fila', 'processando') ORDER BY criada_em",
  );
  for (const r of rows) {
    // reinicia a leitura do arquivo desde o início
    await db.query(
      `DELETE FROM ocorrencia WHERE servidor_id = (SELECT servidor_id FROM analise WHERE id = $1)`,
      [r.id],
    );
    await db.query(
      `DELETE FROM arquivo_log WHERE servidor_id = (SELECT servidor_id FROM analise WHERE id = $1)`,
      [r.id],
    );
    await db.query("UPDATE analise SET situacao = 'na_fila' WHERE id = $1", [r.id]);
    enfileirar(r.id);
  }
}

/** Remove as análises expiradas e as consultas normalizadas que ficaram sem ocorrências. */
export function limparExpiradas() {
  naFila(limpar);
}

async function limpar() {
  const db = pool();
  const { rows } = await db.query<{ id: string; diretorio_logs: string }>(
    `DELETE FROM servidor s USING analise a
     WHERE a.servidor_id = s.id AND a.expira_em < now() AND a.situacao IN ('concluida', 'erro')
     RETURNING a.id, s.diretorio_logs`,
  );
  for (const r of rows) await rm(r.diretorio_logs, { recursive: true, force: true });
  const c = await db.query(
    "DELETE FROM consulta c WHERE NOT EXISTS (SELECT 1 FROM ocorrencia o WHERE o.consulta_id = c.id)",
  );
  if (rows.length || c.rowCount) console.log(`retenção: ${rows.length} análise(s) e ${c.rowCount} consulta(s) removidas`);
}
