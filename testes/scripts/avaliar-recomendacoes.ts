/**
 * Avaliação das recomendações do diagnóstico (casos de teste antes e depois da otimização).
 *
 *   npm run recomendacoes
 *
 * Para cada caso de teste, sobre a base de exemplo do servidor monitorado:
 *   1. a consulta original é executada com o registro em log ativo e o arquivo é lido pelo coletor,
 *      como no uso normal da ferramenta;
 *   2. o diagnóstico é gerado com as mesmas funções da interface (texto, estatísticas e pg_stat_statements);
 *   3. o plano e o tempo são medidos com EXPLAIN (ANALYZE, BUFFERS), com aquecimento e várias execuções;
 *   4. a recomendação é aplicada (o comando SQL sugerido pela ferramenta ou a reescrita indicada);
 *   5. o plano e o tempo são medidos novamente e o resultado é comparado com o original;
 *   6. o banco volta ao estado inicial (índices, visões e extensões criados são removidos).
 *
 * Usa o servidor de exemplo de testes/docker-compose.yml (veja ambiente.ts) e o banco da ferramenta. O resultado é gravado em testes/resultados/.
 */
import { cargaUrl } from "./ambiente";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "pg";
import { lerServidor, type Servidor } from "../../collector/leitura";
import { config } from "../../src/lib/config";
import { pool } from "../../src/lib/db";
import { normalizarSql } from "../../src/lib/normalizar";
import { diagnosticar, type Recomendacao } from "../../src/lib/recomendacoes";

const EXECUCOES = Number(process.env.EXECUCOES ?? 7);
const AQUECIMENTO = 2;
const EXECUCOES_LOG = 5;

interface Etapa {
  rotulo: string;
  /** consulta medida nesta etapa (padrão: a da etapa anterior) */
  consulta?: string;
  /** ids das recomendações cujo comando SQL é aplicado nesta etapa */
  aplicarRecomendacoes?: string[];
  /** comandos executados antes da medição (por exemplo, a criação de uma visão materializada) */
  preparar?: string[];
}

interface Caso {
  id: string;
  titulo: string;
  /** recomendação que o caso deve acionar */
  regra: string;
  consulta: string;
  etapas: Etapa[];
  /** resultado da consulta otimizada deve ser idêntico ao original */
  comparar: "identico" | "aproximado" | "nao_aplicavel";
  dml?: boolean;
}

const CASOS: Caso[] = [
  {
    id: "C1",
    titulo: "Filtro e ordenação sem índice",
    regra: "indice",
    consulta: "SELECT id, status, criado_em FROM pedido WHERE cliente_id = 4242 ORDER BY criado_em DESC LIMIT 20",
    etapas: [{ rotulo: "Índice sugerido", aplicarRecomendacoes: ["indice"] }],
    comparar: "identico",
  },
  {
    id: "C2",
    titulo: "Junção sem índice na chave estrangeira",
    regra: "juncao",
    consulta:
      "SELECT p.id, sum(i.quantidade * i.preco) AS total FROM pedido p JOIN item_pedido i ON i.pedido_id = p.id " +
      "WHERE p.cliente_id = 4242 GROUP BY p.id ORDER BY p.id",
    etapas: [
      { rotulo: "Índice do filtro", aplicarRecomendacoes: ["indice"] },
      { rotulo: "Índice do filtro e da junção", aplicarRecomendacoes: ["juncao"] },
    ],
    comparar: "identico",
  },
  {
    id: "C3",
    titulo: "Busca com curinga no início (ILIKE '%...%')",
    regra: "like-curinga",
    consulta: "SELECT id, nome FROM cliente WHERE nome ILIKE '%te 4242%' ORDER BY id",
    etapas: [{ rotulo: "Índice trigram (pg_trgm)", aplicarRecomendacoes: ["like-curinga"] }],
    comparar: "identico",
  },
  {
    id: "C4",
    titulo: "Função lower() sobre a coluna do filtro",
    regra: "funcao-coluna",
    consulta: "SELECT id, nome FROM cliente WHERE lower(email) = 'cliente4242@exemplo.com'",
    etapas: [{ rotulo: "Índice sobre a expressão", aplicarRecomendacoes: ["funcao-coluna"] }],
    comparar: "identico",
  },
  {
    id: "C5",
    titulo: "Função date() sobre a coluna do filtro",
    regra: "funcao-coluna",
    consulta: "SELECT count(*) FROM pedido WHERE date(criado_em) = current_date - 10",
    etapas: [
      {
        rotulo: "Reescrita como faixa",
        consulta:
          "SELECT count(*) FROM pedido WHERE criado_em >= current_date - 10 AND criado_em < current_date - 9",
      },
      { rotulo: "Reescrita e índice sugerido para a faixa", aplicarRecomendacoes: ["indice"] },
    ],
    comparar: "identico",
  },
  {
    id: "C6",
    titulo: "Paginação com OFFSET alto",
    regra: "offset",
    consulta: "SELECT id, cliente_id, status FROM pedido ORDER BY id LIMIT 50 OFFSET 200000",
    etapas: [
      {
        rotulo: "Paginação por chave (keyset)",
        consulta: "SELECT id, cliente_id, status FROM pedido WHERE id > 200000 ORDER BY id LIMIT 50",
      },
    ],
    comparar: "identico",
  },
  {
    id: "C7",
    titulo: "NOT IN com subconsulta",
    regra: "not-in",
    // restrito aos 1.000 primeiros clientes: com a tabela inteira, a versão com NOT IN levaria horas
    consulta: "SELECT count(*) FROM cliente WHERE id <= 1000 AND id NOT IN (SELECT cliente_id FROM pedido)",
    etapas: [
      {
        rotulo: "Reescrita com NOT EXISTS",
        consulta: "SELECT count(*) FROM cliente c WHERE c.id <= 1000 AND NOT EXISTS (SELECT 1 FROM pedido p WHERE p.cliente_id = c.id)",
      },
    ],
    comparar: "identico",
  },
  {
    id: "C8",
    titulo: "Subconsulta executada para cada linha",
    regra: "subconsulta-select",
    consulta:
      "SELECT c.id, (SELECT count(*) FROM pedido p WHERE p.cliente_id = c.id) AS pedidos FROM cliente c " +
      "WHERE c.cidade = 'Lajeado' ORDER BY c.id LIMIT 100",
    etapas: [
      {
        rotulo: "Reescrita com junção e agrupamento",
        consulta:
          "SELECT c.id, count(p.id) AS pedidos FROM (SELECT id FROM cliente WHERE cidade = 'Lajeado' ORDER BY id LIMIT 100) c " +
          "LEFT JOIN pedido p ON p.cliente_id = c.id GROUP BY c.id ORDER BY c.id",
      },
    ],
    comparar: "identico",
  },
  {
    id: "C9",
    titulo: "Contagem de todas as linhas",
    regra: "count-total",
    consulta: "SELECT count(*) FROM item_pedido",
    etapas: [
      {
        rotulo: "Estimativa do catálogo",
        consulta: "SELECT reltuples::bigint FROM pg_class WHERE oid = 'item_pedido'::regclass",
      },
    ],
    comparar: "aproximado",
  },
  {
    id: "C10",
    titulo: "Agregação sobre a tabela inteira",
    regra: "agregacao-total",
    consulta: "SELECT status, count(*) AS pedidos FROM pedido GROUP BY status ORDER BY status",
    etapas: [
      {
        rotulo: "Visão materializada",
        preparar: ["CREATE MATERIALIZED VIEW resumo_status AS SELECT status, count(*) AS pedidos FROM pedido GROUP BY status"],
        consulta: "SELECT status, pedidos FROM resumo_status ORDER BY status",
      },
    ],
    comparar: "identico",
  },
  {
    id: "C11",
    titulo: "Amostra aleatória com ORDER BY random()",
    regra: "order-random",
    consulta: "SELECT pedido_id, produto_id FROM item_pedido ORDER BY random() LIMIT 5",
    etapas: [
      {
        rotulo: "TABLESAMPLE",
        consulta: "SELECT pedido_id, produto_id FROM item_pedido TABLESAMPLE SYSTEM (0.1) LIMIT 5",
      },
    ],
    comparar: "nao_aplicavel",
  },
  {
    id: "C12",
    titulo: "Atualização sem índice no filtro",
    regra: "indice",
    consulta: "UPDATE pedido SET status = 'enviado' WHERE status = 'pago' AND cliente_id = 4242",
    etapas: [{ rotulo: "Índice sugerido", aplicarRecomendacoes: ["indice"] }],
    comparar: "nao_aplicavel",
    dml: true,
  },
  {
    id: "C13",
    titulo: "Exclusão com chave estrangeira sem índice",
    regra: "delete-fk",
    consulta: "DELETE FROM pedido WHERE id = $PEDIDO_SEM_ITENS",
    etapas: [{ rotulo: "Índice na chave estrangeira", preparar: ["CREATE INDEX ON item_pedido (pedido_id)"] }],
    comparar: "nao_aplicavel",
    dml: true,
  },
  {
    id: "C14",
    titulo: "DISTINCT para remover duplicatas da junção",
    regra: "distinct-join",
    consulta:
      "SELECT DISTINCT c.id, c.nome FROM cliente c JOIN pedido p ON p.cliente_id = c.id " +
      "WHERE p.status = 'cancelado' AND c.cidade = 'Lajeado' ORDER BY c.id",
    etapas: [
      {
        rotulo: "Reescrita com EXISTS",
        consulta:
          "SELECT c.id, c.nome FROM cliente c WHERE c.cidade = 'Lajeado' " +
          "AND EXISTS (SELECT 1 FROM pedido p WHERE p.cliente_id = c.id AND p.status = 'cancelado') ORDER BY c.id",
      },
    ],
    comparar: "identico",
  },
  {
    id: "C15",
    titulo: "Filtros de baixa seletividade",
    regra: "indice",
    consulta:
      "SELECT count(*) FROM cliente c JOIN pedido p ON p.cliente_id = c.id WHERE c.cidade = 'Lajeado' AND p.status = 'cancelado'",
    etapas: [{ rotulo: "Índices sugeridos", aplicarRecomendacoes: ["indice", "juncao"] }],
    comparar: "identico",
  },
];

// ---------------------------------------------------------------------------------------------

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

interface NoPlano {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  "Shared Hit Blocks"?: number;
  "Shared Read Blocks"?: number;
  Plans?: NoPlano[];
}

/** Resumo do plano: tipo de acesso a cada tabela. */
function acessos(no: NoPlano, lista: string[] = []): string[] {
  if (no["Relation Name"]) {
    const indice = no["Index Name"] ? ` (${no["Index Name"]})` : "";
    lista.push(`${no["Node Type"]} em ${no["Relation Name"]}${indice}`);
  }
  for (const f of no.Plans ?? []) acessos(f, lista);
  return lista;
}

interface Medicao {
  consulta: string;
  tempo_ms: number;
  faixa_ms: [number, number];
  planejamento_ms: number;
  blocos: number;
  plano: string[];
  resultado?: string;
  linhas?: number;
}

async function medir(db: Client, consulta: string, dml: boolean): Promise<Medicao> {
  const tempos: number[] = [];
  const planejamentos: number[] = [];
  let blocos = 0;
  let plano: string[] = [];
  for (let i = 0; i < AQUECIMENTO + EXECUCOES; i++) {
    if (dml) await db.query("BEGIN");
    const r = await db.query(`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${consulta}`);
    if (dml) await db.query("ROLLBACK");
    const e = r.rows[0]["QUERY PLAN"][0];
    if (i < AQUECIMENTO) continue;
    tempos.push(e["Execution Time"]);
    planejamentos.push(e["Planning Time"]);
    blocos = (e.Plan["Shared Hit Blocks"] ?? 0) + (e.Plan["Shared Read Blocks"] ?? 0);
    plano = [...new Set(acessos(e.Plan))];
  }
  const m: Medicao = {
    consulta,
    tempo_ms: mediana(tempos),
    faixa_ms: [Math.min(...tempos), Math.max(...tempos)],
    planejamento_ms: mediana(planejamentos),
    blocos,
    plano,
  };
  if (!dml) {
    const r = await db.query(consulta);
    m.linhas = r.rowCount ?? 0;
    m.resultado = createHash("md5").update(JSON.stringify(r.rows)).digest("hex");
    if (r.rows.length === 1 && Object.keys(r.rows[0]).length === 1) m.resultado += ` (${Object.values(r.rows[0])[0]})`;
  }
  return m;
}

/** Executa a consulta com o registro em log ativo, lê o log com o coletor e gera o diagnóstico. */
async function diagnosticoPelaFerramenta(db: Client, servidor: Servidor, consulta: string, dml: boolean) {
  await db.query("SELECT pg_stat_statements_reset()");
  await db.query("SET log_min_duration_statement = 0");
  for (let i = 0; i < EXECUCOES_LOG; i++) {
    if (dml) await db.query("BEGIN");
    await db.query(consulta);
    if (dml) await db.query("ROLLBACK");
  }
  await db.query("SET log_min_duration_statement = -1");
  await new Promise((r) => setTimeout(r, 1500)); // aguarda a gravação do log
  await lerServidor(servidor);

  const { fingerprint, texto } = normalizarSql(consulta);
  const ferramenta = pool();
  const c = (await ferramenta.query("SELECT id, query_id::text FROM consulta WHERE fingerprint = $1", [fingerprint])).rows[0];
  if (!c) throw new Error(`consulta não registrada pela ferramenta: ${texto}`);
  const est = (
    await ferramenta.query(
      `SELECT count(*)::int AS n, sum(duracao_ms)::float8 AS total, avg(duracao_ms)::float8 AS media,
              percentile_cont(0.5) WITHIN GROUP (ORDER BY duracao_ms) AS mediana,
              percentile_cont(0.95) WITHIN GROUP (ORDER BY duracao_ms) AS p95, max(duracao_ms)::float8 AS max,
              (array_agg(texto_executado ORDER BY duracao_ms DESC))[1] AS exemplo
       FROM ocorrencia WHERE consulta_id = $1 AND servidor_id = $2`,
      [c.id, servidor.id],
    )
  ).rows[0];
  const pgss = c.query_id
    ? (
        await db.query(
          `SELECT sum(calls)::float8 AS calls, sum(total_exec_time)/nullif(sum(calls),0) AS mean_exec_time,
                  sum(rows)::float8 AS rows, sum(shared_blks_hit)::float8 AS shared_blks_hit, sum(shared_blks_read)::float8 AS shared_blks_read
           FROM pg_stat_statements WHERE queryid = $1`,
          [c.query_id],
        )
      ).rows[0]
    : null;
  const recs = diagnosticar({
    texto,
    exemplo: est.exemplo,
    ocorrencias: est.n,
    tempo_total_ms: est.total,
    media_ms: est.media,
    mediana_ms: est.mediana,
    p95_ms: est.p95,
    max_ms: est.max,
    participacao: null,
    pgss: pgss?.calls ? pgss : null,
  });
  return { ocorrencias: est.n, recs };
}

/** Comandos executáveis de uma recomendação (descarta comentários e trechos que não são instruções completas). */
function comandos(r: Recomendacao): string[] {
  return (r.sql ?? "")
    .split(/;\s*(?:\n|$)/)
    .map((s) => s.replace(/--.*$/gm, "").trim())
    .filter((s) => /^(CREATE|ALTER)\b/i.test(s));
}

async function main() {
  const db = new Client({ connectionString: cargaUrl, application_name: "avaliacao-recomendacoes" });
  await db.connect();
  const ferramenta = pool();
  // cadastra o servidor de exemplo, como o coletor faria ao iniciar
  const servidor = (
    await ferramenta.query<Servidor>(
      `INSERT INTO servidor (nome, diretorio_logs, formato_log) VALUES ($1, $2, 'csvlog')
       ON CONFLICT (nome) DO UPDATE SET diretorio_logs = EXCLUDED.diretorio_logs
       RETURNING id, nome, diretorio_logs, formato_log`,
      [config.servidorNome, config.diretorioLogs],
    )
  ).rows[0];
  await db.query("CREATE EXTENSION IF NOT EXISTS pg_stat_statements");
  const indicesIniciais = new Set((await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'")).rows.map((r) => r.indexname));
  const pedidoSemItens = (
    await db.query("SELECT id FROM pedido p WHERE NOT EXISTS (SELECT 1 FROM item_pedido i WHERE i.pedido_id = p.id) ORDER BY id LIMIT 1")
  ).rows[0].id;
  const versao = (await db.query("SHOW server_version")).rows[0].server_version;

  async function restaurar() {
    const r = await db.query("SELECT indexname FROM pg_indexes WHERE schemaname = 'public'");
    for (const { indexname } of r.rows) if (!indicesIniciais.has(indexname)) await db.query(`DROP INDEX IF EXISTS "${indexname}"`);
    await db.query("DROP MATERIALIZED VIEW IF EXISTS resumo_status");
    await db.query("DROP EXTENSION IF EXISTS pg_trgm CASCADE");
    await db.query("ANALYZE");
  }

  const resultados = [];
  await restaurar();
  for (const caso of CASOS) {
    const consulta = caso.consulta.replace("$PEDIDO_SEM_ITENS", String(pedidoSemItens));
    console.log(`\n${caso.id} ${caso.titulo}`);
    const dml = caso.dml ?? false;
    const diag = await diagnosticoPelaFerramenta(db, servidor, consulta, dml);
    const ids = diag.recs.map((r) => r.id);
    const acionada = ids.includes(caso.regra);
    console.log(`  recomendações: ${ids.join(", ")} ${acionada ? "" : `(ATENÇÃO: ${caso.regra} não foi acionada)`}`);
    const antes = await medir(db, consulta, dml);
    console.log(`  antes: ${antes.tempo_ms.toFixed(2)} ms, ${antes.blocos} blocos, ${antes.plano.join("; ")}`);

    const etapas = [];
    let atual = consulta;
    let recsAtuais = diag.recs;
    const aplicados: string[] = [];
    for (const e of caso.etapas) {
      for (const sql of e.preparar ?? []) {
        await db.query(sql);
        aplicados.push(sql);
      }
      if (e.consulta) atual = e.consulta;
      for (const id of e.aplicarRecomendacoes ?? []) {
        // na etapa de uma consulta reescrita, a recomendação vem do diagnóstico da nova consulta
        if (e.consulta || !recsAtuais.some((r) => r.id === id)) recsAtuais = (await diagnosticoPelaFerramenta(db, servidor, atual, dml)).recs;
        const r = recsAtuais.find((x) => x.id === id);
        if (!r) {
          console.log(`  recomendação ${id} não gerada para a consulta atual`);
          continue;
        }
        for (const sql of comandos(r)) {
          await db.query(sql);
          aplicados.push(sql);
        }
      }
      await db.query("ANALYZE");
      const depois = await medir(db, atual, dml);
      const ganho = antes.tempo_ms / Math.max(depois.tempo_ms, 0.001);
      const equivalente =
        caso.comparar === "identico" ? depois.resultado === antes.resultado : caso.comparar === "aproximado" ? null : null;
      console.log(
        `  ${e.rotulo}: ${depois.tempo_ms.toFixed(2)} ms (${ganho.toFixed(1)}x), ${depois.blocos} blocos, ${depois.plano.join("; ")}` +
          (caso.comparar === "identico" ? `, resultado ${equivalente ? "idêntico" : "DIFERENTE"}` : ""),
      );
      etapas.push({ rotulo: e.rotulo, depois, ganho, equivalente, aplicados: [...aplicados] });
    }
    resultados.push({ caso: { ...caso, consulta }, ocorrencias_log: diag.ocorrencias, recomendacoes: diag.recs, acionada, antes, etapas });
    await restaurar();
  }

  const pasta = path.resolve("testes", "resultados");
  mkdirSync(pasta, { recursive: true });
  const carimbo = new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "");
  const ambiente = {
    servidor: versao,
    cpu: os.cpus()[0]?.model,
    nucleos: os.cpus().length,
    memoria_gb: Math.round(os.totalmem() / 2 ** 30),
    so: `${os.type()} ${os.release()}`,
    execucoes: EXECUCOES,
    indices_iniciais: [...indicesIniciais].sort(),
  };
  writeFileSync(path.join(pasta, `recomendacoes-${carimbo}.json`), JSON.stringify({ ambiente, resultados }, null, 2));

  const fmt = (v: number) => (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(2)).replace(".", ",");
  const linhas = resultados.flatMap((r) =>
    r.etapas.map(
      (e) =>
        `| ${r.caso.id} | ${r.caso.titulo} | ${r.acionada ? r.caso.regra : `não acionada (${r.caso.regra})`} | ${e.rotulo} | ` +
        `${fmt(r.antes.tempo_ms)} ms | ${fmt(e.depois.tempo_ms)} ms | ${fmt(e.ganho)}x | ${r.antes.blocos} / ${e.depois.blocos} | ` +
        `${r.antes.plano.join("; ")} → ${e.depois.plano.join("; ") || "sem acesso a tabelas"} | ` +
        `${r.caso.comparar === "identico" ? (e.equivalente ? "idêntico" : "diferente") : r.caso.comparar === "aproximado" ? "aproximado" : "não se aplica"} |`,
    ),
  );
  const md = `# Avaliação das recomendações

- **Servidor:** PostgreSQL ${versao}
- **Ambiente:** ${ambiente.cpu}, ${ambiente.nucleos} núcleos, ${ambiente.memoria_gb} GB, ${ambiente.so}
- **Índices existentes no início:** ${ambiente.indices_iniciais.join(", ")}
- **Medição:** EXPLAIN (ANALYZE, BUFFERS), ${AQUECIMENTO} execuções de aquecimento e ${EXECUCOES} medidas; mediana do tempo de execução

| Caso | Problema | Recomendação | Etapa | Antes | Depois | Ganho | Blocos (antes / depois) | Plano | Resultado |
| --- | --- | --- | --- | ---: | ---: | ---: | --- | --- | --- |
${linhas.join("\n")}
`;
  writeFileSync(path.join(pasta, `recomendacoes-${carimbo}.md`), md);
  console.log(`\n${md}`);
  await db.end();
  await ferramenta.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
