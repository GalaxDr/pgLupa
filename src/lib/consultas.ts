import "server-only";
import { pool } from "./db";
import { ORDENS, PERIODOS, type Filtros } from "./filtros";

/** Constrói as condições SQL dos filtros sobre a tabela ocorrencia (alias o). */
function condicoes(f: Filtros, consultaId?: number, incluirPeriodo = true) {
  const where: string[] = [];
  const params: unknown[] = [];
  const add = (sql: string, valor: unknown) => {
    params.push(valor);
    where.push(sql.replace("?", `$${params.length}`));
  };
  const intervalo = PERIODOS[f.periodo].intervalo;
  if (incluirPeriodo && intervalo) add("o.data_hora >= now() - ?::interval", intervalo);
  if (f.servidor) add("o.servidor_id = ?", f.servidor);
  // sem servidor definido, as páginas gerais mostram apenas os servidores do coletor, não as análises enviadas
  else where.push("o.servidor_id NOT IN (SELECT servidor_id FROM analise)");
  if (f.banco) add("o.banco = ?", f.banco);
  if (f.usuario) add("o.usuario = ?", f.usuario);
  if (consultaId) add("o.consulta_id = ?", consultaId);
  if (f.busca) {
    add("o.consulta_id IN (SELECT id FROM consulta WHERE texto_normalizado ILIKE ?)", `%${f.busca}%`);
  }
  return { where, params };
}

const sqlWhere = (where: string[]) => (where.length ? `WHERE ${where.join(" AND ")}` : "");

export interface Resumo {
  ocorrencias: number;
  consultas: number;
  tempo_total_ms: number;
  media_ms: number | null;
  mediana_ms: number | null;
  p95_ms: number | null;
  max_ms: number | null;
  primeira: Date | null;
  ultima: Date | null;
}

export async function obterResumo(f: Filtros, consultaId?: number): Promise<Resumo> {
  const { where, params } = condicoes(f, consultaId);
  const { rows } = await pool().query<Resumo>(
    `SELECT count(*)::int AS ocorrencias,
            count(DISTINCT o.consulta_id)::int AS consultas,
            COALESCE(sum(o.duracao_ms), 0)::float8 AS tempo_total_ms,
            avg(o.duracao_ms)::float8 AS media_ms,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY o.duracao_ms) AS mediana_ms,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY o.duracao_ms) AS p95_ms,
            max(o.duracao_ms)::float8 AS max_ms,
            min(o.data_hora) AS primeira, max(o.data_hora) AS ultima
     FROM ocorrencia o ${sqlWhere(where)}`,
    params,
  );
  return rows[0];
}

export interface PontoSerie {
  instante: string;
  ocorrencias: number;
  p95_ms: number | null;
  media_ms: number | null;
}

/** Ocorrências agrupadas em intervalos de tempo, com os intervalos vazios preenchidos. */
export async function obterSerie(f: Filtros, consultaId?: number): Promise<PontoSerie[]> {
  let { intervalo, bucket } = PERIODOS[f.periodo] as { intervalo: string | null; bucket: string | null };
  const { where, params } = condicoes(f, consultaId, false);

  // fim da série: agora, ou a última ocorrência quando o período é "todo" (ex.: arquivo enviado)
  let fim = "now()";
  if (!intervalo) {
    const r = await pool().query<{ segundos: number | null }>(
      `SELECT extract(epoch FROM max(o.data_hora) - min(o.data_hora))::float8 AS segundos FROM ocorrencia o ${sqlWhere(where)}`,
      params,
    );
    const s = r.rows[0]?.segundos;
    if (s === null || s === undefined) return [];
    const minutos = s / 60;
    bucket =
      minutos <= 15 ? "10 seconds" : minutos <= 60 ? "1 minute" : minutos <= 360 ? "5 minutes" : minutos <= 1440 ? "15 minutes"
      : minutos <= 10080 ? "2 hours" : minutos <= 43200 ? "6 hours" : minutos <= 259200 ? "1 day" : "7 days";
    intervalo = `${Math.ceil(s) + 1} seconds`;
    fim = `(SELECT max(o.data_hora) FROM ocorrencia o ${sqlWhere(where)})`;
  }

  const n = params.length;
  const juncao = where.length ? `AND ${where.join(" AND ")}` : "";
  const { rows } = await pool().query<PontoSerie>(
    `WITH b AS (
       SELECT generate_series(
         date_bin($${n + 1}::interval, ${fim} - $${n + 2}::interval, timestamptz '2000-01-01 00:00:00-03'),
         ${fim}, $${n + 1}::interval) AS instante
     )
     SELECT b.instante, count(o.id)::int AS ocorrencias,
            percentile_cont(0.95) WITHIN GROUP (ORDER BY o.duracao_ms) AS p95_ms,
            avg(o.duracao_ms)::float8 AS media_ms
     FROM b
     LEFT JOIN ocorrencia o
       ON o.data_hora >= b.instante AND o.data_hora < b.instante + $${n + 1}::interval ${juncao}
     GROUP BY b.instante ORDER BY b.instante`,
    [...params, bucket, intervalo],
  );
  return rows.map((r) => ({ ...r, instante: new Date(r.instante).toISOString() }));
}

export interface LinhaConsulta {
  id: number;
  query_id: string | null;
  texto_normalizado: string;
  ocorrencias: number;
  tempo_total_ms: number;
  media_ms: number;
  mediana_ms: number;
  p95_ms: number;
  max_ms: number;
  primeira: Date;
  ultima: Date;
}

/** Consultas agrupadas, com os indicadores calculados sobre as ocorrências filtradas. */
export async function listarConsultas(f: Filtros, limite = 100): Promise<LinhaConsulta[]> {
  const { where, params } = condicoes(f);
  const coluna = ORDENS[f.ordem].coluna;
  const { rows } = await pool().query<LinhaConsulta>(
    `SELECT c.id, c.query_id::text AS query_id, c.texto_normalizado, a.ocorrencias, a.tempo_total_ms, a.media_ms, a.mediana_ms, a.p95_ms, a.max_ms, a.primeira, a.ultima
     FROM (
       SELECT o.consulta_id,
              count(*)::int AS ocorrencias,
              sum(o.duracao_ms)::float8 AS tempo_total_ms,
              avg(o.duracao_ms)::float8 AS media_ms,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY o.duracao_ms) AS mediana_ms,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY o.duracao_ms) AS p95_ms,
              max(o.duracao_ms)::float8 AS max_ms,
              min(o.data_hora) AS primeira,
              max(o.data_hora) AS ultima
       FROM ocorrencia o ${sqlWhere(where)}
       GROUP BY o.consulta_id
     ) a
     JOIN consulta c ON c.id = a.consulta_id
     ORDER BY a.${coluna} DESC NULLS LAST
     LIMIT ${Math.max(1, Math.min(limite, 1000))}`,
    params,
  );
  return rows;
}

export interface Consulta {
  id: number;
  query_id: string | null;
  fingerprint: string;
  texto_normalizado: string;
  primeira_ocorrencia: Date;
  ultima_ocorrencia: Date;
}

export async function obterConsulta(id: number): Promise<Consulta | null> {
  const { rows } = await pool().query<Consulta>("SELECT id, query_id::text AS query_id, fingerprint, texto_normalizado, primeira_ocorrencia, ultima_ocorrencia FROM consulta WHERE id = $1", [id]);
  return rows[0] ?? null;
}

export interface LinhaOcorrencia {
  id: number;
  data_hora: Date;
  duracao_ms: number;
  banco: string | null;
  usuario: string | null;
  aplicacao: string | null;
  host_cliente: string | null;
  pid: number | null;
  texto_executado: string;
  servidor: string;
}

export async function listarOcorrencias(f: Filtros, consultaId: number, limite = 50): Promise<LinhaOcorrencia[]> {
  const { where, params } = condicoes(f, consultaId);
  const { rows } = await pool().query<LinhaOcorrencia>(
    `SELECT o.id, o.data_hora, o.duracao_ms, o.banco, o.usuario, o.aplicacao, o.host_cliente, o.pid,
            o.texto_executado, s.nome AS servidor
     FROM ocorrencia o JOIN servidor s ON s.id = o.servidor_id
     ${sqlWhere(where)}
     ORDER BY o.data_hora DESC LIMIT ${Math.max(1, Math.min(limite, 500))}`,
    params,
  );
  return rows;
}

/** Texto executado da ocorrência mais lenta de cada consulta, com os valores dos parâmetros. */
export async function obterExemplos(f: Filtros, consultaIds: number[]): Promise<Map<number, string>> {
  if (consultaIds.length === 0) return new Map();
  const { where, params } = condicoes(f);
  params.push(consultaIds);
  where.push(`o.consulta_id = ANY($${params.length}::bigint[])`);
  const { rows } = await pool().query<{ consulta_id: number; texto_executado: string }>(
    `SELECT DISTINCT ON (o.consulta_id) o.consulta_id, o.texto_executado
     FROM ocorrencia o ${sqlWhere(where)}
     ORDER BY o.consulta_id, o.duracao_ms DESC`,
    params,
  );
  return new Map(rows.map((r) => [Number(r.consulta_id), r.texto_executado]));
}

export interface PontoDuracao {
  instante: number;
  duracao_ms: number;
}

/** Duração de cada ocorrência ao longo do tempo (amostra limitada às mais recentes). */
export async function listarDuracoes(f: Filtros, consultaId: number, limite = 2000): Promise<PontoDuracao[]> {
  const { where, params } = condicoes(f, consultaId);
  const { rows } = await pool().query<{ data_hora: Date; duracao_ms: number }>(
    `SELECT o.data_hora, o.duracao_ms FROM ocorrencia o ${sqlWhere(where)} ORDER BY o.data_hora DESC LIMIT ${limite}`,
    params,
  );
  return rows.map((r) => ({ instante: r.data_hora.getTime(), duracao_ms: r.duracao_ms })).reverse();
}

export interface ItemDistribuicao {
  valor: string | null;
  ocorrencias: number;
  tempo_total_ms: number;
}

const CAMPOS_DISTRIBUICAO = { banco: "o.banco", usuario: "o.usuario", aplicacao: "o.aplicacao", host: "o.host_cliente" };

export async function obterDistribuicao(
  f: Filtros,
  consultaId: number,
  campo: keyof typeof CAMPOS_DISTRIBUICAO,
): Promise<ItemDistribuicao[]> {
  const { where, params } = condicoes(f, consultaId);
  const col = CAMPOS_DISTRIBUICAO[campo];
  const { rows } = await pool().query<ItemDistribuicao>(
    `SELECT ${col} AS valor, count(*)::int AS ocorrencias, sum(o.duracao_ms)::float8 AS tempo_total_ms
     FROM ocorrencia o ${sqlWhere(where)}
     GROUP BY ${col} ORDER BY ocorrencias DESC LIMIT 5`,
    params,
  );
  return rows;
}

export interface EstatisticaPgss {
  coletado_em: Date;
  calls: number;
  total_exec_time: number;
  mean_exec_time: number;
  rows: number;
  shared_blks_hit: number;
  shared_blks_read: number;
  /** variação em relação ao snapshot anterior */
  delta_calls: number | null;
  delta_total_exec_time: number | null;
  anterior_em: Date | null;
}

/** Último snapshot do pg_stat_statements associado à consulta pelo query_id. */
export async function obterEstatisticasPgss(queryId: string | null): Promise<EstatisticaPgss | null> {
  if (queryId === null) return null;
  const { rows } = await pool().query(
    `SELECT coletado_em, calls, total_exec_time, mean_exec_time, rows, shared_blks_hit, shared_blks_read
     FROM snapshot_estatistica WHERE query_id = $1::bigint ORDER BY coletado_em DESC LIMIT 2`,
    [queryId],
  );
  if (rows.length === 0) return null;
  const [atual, anterior] = rows;
  // contadores menores que os do snapshot anterior indicam que as estatísticas foram reiniciadas
  const valido = anterior && atual.calls >= anterior.calls;
  return {
    ...atual,
    delta_calls: valido ? atual.calls - anterior.calls : null,
    delta_total_exec_time: valido ? atual.total_exec_time - anterior.total_exec_time : null,
    anterior_em: anterior?.coletado_em ?? null,
  };
}

export interface OpcoesFiltro {
  servidores: { id: number; nome: string }[];
  bancos: string[];
  usuarios: string[];
}

/**
 * Opções dos filtros. Com um servidor informado (ex.: uma análise enviada), considera apenas as
 * ocorrências desse servidor, sem limite de período.
 */
export async function obterOpcoesFiltro(servidorId?: number): Promise<OpcoesFiltro> {
  const db = pool();
  const escopo = servidorId
    ? { cond: "servidor_id = $1", params: [servidorId] }
    : { cond: "data_hora >= now() - interval '30 days'", params: [] };
  const [s, b, u] = await Promise.all([
    servidorId
      ? Promise.resolve({ rows: [] as { id: number; nome: string }[] })
      : db.query<{ id: number; nome: string }>("SELECT id, nome FROM servidor WHERE ativo ORDER BY nome"),
    db.query<{ v: string }>(
      `SELECT DISTINCT banco AS v FROM ocorrencia WHERE banco IS NOT NULL AND ${escopo.cond} ORDER BY 1 LIMIT 200`,
      escopo.params,
    ),
    db.query<{ v: string }>(
      `SELECT DISTINCT usuario AS v FROM ocorrencia WHERE usuario IS NOT NULL AND ${escopo.cond} ORDER BY 1 LIMIT 200`,
      escopo.params,
    ),
  ]);
  return { servidores: s.rows, bancos: b.rows.map((r) => r.v), usuarios: u.rows.map((r) => r.v) };
}

export interface EstadoServidor {
  id: number;
  nome: string;
  diretorio_logs: string;
  formato_log: string;
  ativo: boolean;
  ultima_leitura: Date | null;
  ultimo_snapshot: Date | null;
  ocorrencias_24h: number;
  arquivos: { nome_arquivo: string; posicao_lida: number; tamanho: number; atualizado_em: Date }[];
}

export async function obterEstadoColetor(): Promise<EstadoServidor[]> {
  const { rows } = await pool().query<EstadoServidor>(
    `SELECT s.id, s.nome, s.diretorio_logs, s.formato_log, s.ativo,
            (SELECT max(atualizado_em) FROM arquivo_log a WHERE a.servidor_id = s.id) AS ultima_leitura,
            (SELECT max(coletado_em) FROM snapshot_estatistica e WHERE e.servidor_id = s.id) AS ultimo_snapshot,
            (SELECT count(*)::int FROM ocorrencia o WHERE o.servidor_id = s.id AND o.data_hora >= now() - interval '24 hours') AS ocorrencias_24h,
            COALESCE((SELECT json_agg(json_build_object(
                'nome_arquivo', a.nome_arquivo, 'posicao_lida', a.posicao_lida,
                'tamanho', a.tamanho, 'atualizado_em', a.atualizado_em) ORDER BY a.atualizado_em DESC)
              FROM arquivo_log a WHERE a.servidor_id = s.id), '[]') AS arquivos
     FROM servidor s WHERE NOT EXISTS (SELECT 1 FROM analise a WHERE a.servidor_id = s.id) ORDER BY s.nome`,
  );
  return rows;
}
