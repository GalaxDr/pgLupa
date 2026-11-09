/**
 * Avaliação da ferramenta segundo os critérios da seção 3.3 do TC:
 *   (i)   acurácia na identificação das consultas lentas;
 *   (ii)  completude da extração dos campos estruturados;
 *   (iii) tempo de processamento por volume de log analisado;
 *   (iv)  sobrecarga imposta ao ambiente (processamento, memória e disco);
 * e comparação opcional com o relatório JSON do pgBadger sobre o mesmo arquivo.
 *
 * A referência ("o que está realmente no log") é obtida carregando o arquivo no próprio
 * PostgreSQL com COPY, isto é, com o leitor de CSV do SGBD, independente do leitor do coletor.
 *
 *   npm run avaliacao -- <arquivo .csv ou .json> [opções]
 *
 *   --execucoes N          número de execuções para medir o tempo (padrão 5)
 *   --pgbadger arq.json    relatório do pgBadger (pgbadger -f csv -x json -o arq.json <log>)
 *   --tempo-pgbadger S     tempo, em segundos, que o pgBadger levou para gerar o relatório
 *   --cenario "texto"      descrição do cenário, incluída no relatório
 *   --manter               mantém no banco as ocorrências da última execução (servidor "avaliacao")
 */
import "./ambiente";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync, createReadStream } from "node:fs";
import os from "node:os";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { Client, type PoolClient } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { config } from "../../src/lib/config";
import { pool } from "../../src/lib/db";
import { lerServidor, type Servidor } from "../../collector/leitura";
import { LIMITE_CONSULTAS, SQL_PG_STAT_STATEMENTS } from "../../collector/estatisticas";
import type { FormatoLog } from "../../collector/tipos";

// ---------------------------------------------------------------- argumentos

const args = process.argv.slice(2);
const opcao = (nome: string) => {
  const i = args.indexOf(nome);
  return i >= 0 ? args[i + 1] : undefined;
};
const COM_VALOR = new Set(["--execucoes", "--pgbadger", "--tempo-pgbadger", "--cenario"]);
const arquivo = args.find((a, i) => !a.startsWith("--") && !COM_VALOR.has(args[i - 1]));
if (!arquivo) {
  console.error("uso: npm run avaliacao -- <arquivo .csv ou .json> [--execucoes 5] [--pgbadger saida.json] [--tempo-pgbadger S] [--cenario texto] [--manter]");
  process.exit(1);
}
const caminhoLog = path.resolve(arquivo);
const formato: FormatoLog = caminhoLog.endsWith(".json") ? "jsonlog" : "csvlog";
const execucoes = Math.max(1, Number(opcao("--execucoes") ?? 5));
const arquivoPgbadger = opcao("--pgbadger");
const tempoPgbadger = opcao("--tempo-pgbadger") ? Number(opcao("--tempo-pgbadger")) : null;
const cenario = opcao("--cenario") ?? "";
const manter = args.includes("--manter");

// memória do processo antes de qualquer processamento (runtime do Node.js e bibliotecas)
const RSS_BASE = process.memoryUsage().rss;

// ---------------------------------------------------------------- utilitários

const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v: number, casas = 2) => v.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
const pct = (a: number, b: number) => (b === 0 ? "–" : `${fmt((a / b) * 100, 2)}%`);
const MB = 1024 * 1024;

// ---------------------------------------------------------------- referência

const COLUNAS_CSVLOG = `log_time text, user_name text, database_name text, process_id text, connection_from text,
  session_id text, session_line_num text, command_tag text, session_start_time text, virtual_transaction_id text,
  transaction_id text, error_severity text, sql_state_code text, message text, detail text, hint text,
  internal_query text, internal_query_pos text, context text, query text, query_pos text, location text,
  application_name text, backend_type text, leader_pid text, query_id text`;

/** Carrega o arquivo de log em uma tabela temporária e extrai as consultas lentas esperadas. */
async function carregarReferencia(client: PoolClient): Promise<{ linhas: number; etapas: Record<string, number> }> {
  if (formato === "csvlog") {
    await client.query(`CREATE TEMP TABLE ref_log (${COLUNAS_CSVLOG})`);
    await pipeline(createReadStream(caminhoLog), client.query(copyFrom("COPY ref_log FROM STDIN WITH (FORMAT csv)")));
    await client.query(`CREATE TEMP TABLE ref_msg AS
      SELECT log_time::timestamptz AS data_hora, NULLIF(process_id, '')::int AS pid, error_severity AS severidade,
             message AS mensagem, NULLIF(user_name, '') AS usuario, NULLIF(database_name, '') AS banco,
             NULLIF(application_name, '') AS aplicacao, NULLIF(connection_from, '') AS host_cliente,
             NULLIF(NULLIF(query_id, ''), '0') AS query_id
      FROM ref_log`);
  } else {
    await client.query("CREATE TEMP TABLE ref_bruto (linha text)");
    await pipeline(
      createReadStream(caminhoLog),
      client.query(copyFrom("COPY ref_bruto FROM STDIN WITH (FORMAT csv, QUOTE e'\\x01', DELIMITER e'\\x02')")),
    );
    await client.query(`CREATE TEMP TABLE ref_msg AS
      SELECT (j->>'timestamp')::timestamptz AS data_hora, (j->>'pid')::int AS pid, j->>'error_severity' AS severidade,
             j->>'message' AS mensagem, NULLIF(j->>'user', '') AS usuario, NULLIF(j->>'dbname', '') AS banco,
             NULLIF(j->>'application_name', '') AS aplicacao, NULLIF(j->>'remote_host', '') AS host_cliente,
             NULLIF(NULLIF(j->>'query_id', ''), '0') AS query_id
      FROM (SELECT linha::jsonb AS j FROM ref_bruto WHERE linha <> '') t`);
  }
  // regra da documentação do PostgreSQL para log_min_duration_statement
  await client.query(`CREATE TEMP TABLE ref AS
    SELECT data_hora, pid, usuario, banco, aplicacao, host_cliente, query_id, m[2] AS etapa,
           round(m[1]::numeric, 3) AS duracao_ms,
           btrim(regexp_replace(mensagem, '^duration: [0-9.]+ ms  [a-z]+[^:]*: ', '')) AS sql
    FROM (SELECT *, regexp_match(mensagem, '^duration: ([0-9.]+) ms  (statement|execute|parse|bind)') AS m FROM ref_msg
          WHERE severidade = 'LOG') x
    WHERE m IS NOT NULL`);
  const { rows: [{ linhas }] } = await client.query("SELECT count(*)::int AS linhas FROM ref_msg");
  const { rows } = await client.query("SELECT etapa, count(*)::int AS n FROM ref GROUP BY etapa");
  return { linhas, etapas: Object.fromEntries(rows.map((r) => [r.etapa, r.n])) };
}

// ---------------------------------------------------------------- execução da ferramenta

interface Medicao {
  segundos: number;
  cpuSegundos: number;
  rssPicoMB: number;
  ocorrencias: number;
}

async function criarServidor(nome: string, dir: string): Promise<Servidor> {
  await pool().query("DELETE FROM servidor WHERE nome = $1", [nome]);
  // inativo: o coletor em execução não lê os servidores de avaliação
  const { rows } = await pool().query<Servidor>(
    `INSERT INTO servidor (nome, diretorio_logs, formato_log, ativo) VALUES ($1, $2, $3, false)
     RETURNING id, nome, diretorio_logs, formato_log`,
    [nome, dir, formato],
  );
  return rows[0];
}

async function executarFerramenta(servidor: Servidor): Promise<Medicao> {
  let rssPico = process.memoryUsage().rss;
  const amostrador = setInterval(() => {
    rssPico = Math.max(rssPico, process.memoryUsage().rss);
  }, 20);
  const cpu0 = process.cpuUsage();
  const t0 = process.hrtime.bigint();
  const ocorrencias = await lerServidor(servidor);
  const segundos = Number(process.hrtime.bigint() - t0) / 1e9;
  const cpu = process.cpuUsage(cpu0);
  clearInterval(amostrador);
  rssPico = Math.max(rssPico, process.memoryUsage().rss);
  return { segundos, cpuSegundos: (cpu.user + cpu.system) / 1e6, rssPicoMB: rssPico / MB, ocorrencias };
}

// ---------------------------------------------------------------- comparação com o pgBadger

/** Forma canônica para comparar textos normalizados pela ferramenta e pelo pgBadger. */
function canonica(t: string): string {
  return t
    .toLowerCase()
    .replace(/\$\d+/g, "?")
    .replace(/\?\s*\/\*,\s*\.\.\.\s*\*\//g, "...")
    .replace(/\(\s*\?(?:\s*,\s*\?)+\s*\)/g, "(...)")
    .replace(/\[\s*\?(?:\s*,\s*\?)+\s*\]/g, "[...]")
    .replace(/\[\s*\.\.\.\s*\]/g, "[...]")
    .replace(/\s*;\s*$/, "")
    .replace(/\s+/g, " ")
    .replace(/\s*([^\w\s?.])\s*/g, "$1")
    .trim();
}

interface ItemPgbadger {
  count: number;
  duration: number;
  max?: number;
}

function lerPgbadger(caminho: string) {
  const d = JSON.parse(readFileSync(caminho, "utf8"));
  const total: number = d.overall_stat?.queries_number ?? 0;
  const consultas = new Map<string, ItemPgbadger>();
  for (const porBanco of Object.values(d.normalyzed_info ?? {}) as Record<string, ItemPgbadger>[]) {
    for (const [texto, info] of Object.entries(porBanco)) {
      const k = canonica(texto);
      const atual = consultas.get(k) ?? { count: 0, duration: 0 };
      consultas.set(k, { count: atual.count + (info.count ?? 0), duration: atual.duration + (info.duration ?? 0) });
    }
  }
  return { total, consultas };
}

// ---------------------------------------------------------------- principal

async function main() {
  const tamanho = statSync(caminhoLog).size;
  console.log(`arquivo: ${caminhoLog} (${fmt(tamanho / MB)} MB, ${formato})`);

  // cópia isolada do arquivo: o original pode continuar crescendo durante a avaliação
  const dir = mkdtempSync(path.join(os.tmpdir(), "sqm-avaliacao-"));
  copyFileSync(caminhoLog, path.join(dir, `avaliacao${formato === "csvlog" ? ".csv" : ".json"}`));

  const client = await pool().connect();
  try {
    console.log("carregando a referência com COPY...");
    const ref = await carregarReferencia(client);
    const esperadas = (ref.etapas.statement ?? 0) + (ref.etapas.execute ?? 0);

    // (iii) e (iv): execuções repetidas, cada uma a partir do início do arquivo
    const medicoes: Medicao[] = [];
    let servidor!: Servidor;
    for (let i = 1; i <= execucoes; i++) {
      servidor = await criarServidor("avaliacao", dir);
      const m = await executarFerramenta(servidor);
      medicoes.push(m);
      console.log(`execução ${i}/${execucoes}: ${fmt(m.segundos, 3)} s, ${m.ocorrencias} ocorrências`);
    }
    const { rows: [{ bytes_ocorrencias }] } = await client.query(
      "SELECT COALESCE(sum(pg_column_size(o.*)), 0)::float8 AS bytes_ocorrencias FROM ocorrencia o WHERE servidor_id = $1",
      [servidor.id],
    );

    // (i) acurácia: pareamento das ocorrências com a referência por data e hora, processo e duração
    await client.query(
      `CREATE TEMP TABLE ferramenta AS
       SELECT o.*, c.query_id AS consulta_query_id FROM ocorrencia o JOIN consulta c ON c.id = o.consulta_id WHERE o.servidor_id = $1`,
      [servidor.id],
    );
    const { rows: [ac] } = await client.query(`
      WITH r AS (SELECT *, row_number() OVER (PARTITION BY data_hora, pid, duracao_ms) AS k FROM ref WHERE etapa IN ('statement', 'execute')),
           t AS (SELECT *, row_number() OVER (PARTITION BY data_hora, pid, duracao_ms) AS k FROM ferramenta)
      SELECT count(*) FILTER (WHERE r.k IS NOT NULL AND t.k IS NOT NULL)::int AS corretas,
             count(*) FILTER (WHERE t.k IS NULL)::int AS nao_detectadas,
             count(*) FILTER (WHERE r.k IS NULL)::int AS indevidas,
             count(*) FILTER (WHERE r.etapa = 'statement' AND t.k IS NOT NULL)::int AS statement_pareadas,
             count(*) FILTER (WHERE r.etapa = 'statement' AND t.k IS NOT NULL AND btrim(t.texto_executado) = r.sql)::int AS texto_identico
      FROM r FULL JOIN t USING (data_hora, pid, duracao_ms, k)`);
    // registros indevidos que correspondem a etapas parse/bind (que deveriam ser ignoradas)
    const { rows: [ignoradas] } = await client.query(`
      WITH r AS (SELECT *, row_number() OVER (PARTITION BY data_hora, pid, duracao_ms) AS k FROM ref WHERE etapa IN ('statement', 'execute')),
           t AS (SELECT *, row_number() OVER (PARTITION BY data_hora, pid, duracao_ms) AS k FROM ferramenta),
           sobra AS (SELECT t.* FROM t LEFT JOIN r USING (data_hora, pid, duracao_ms, k) WHERE r.k IS NULL)
      SELECT count(*)::int AS n FROM sobra s
      WHERE EXISTS (SELECT 1 FROM ref p WHERE p.etapa IN ('parse', 'bind') AND p.data_hora = s.data_hora AND p.pid = s.pid AND p.duracao_ms = s.duracao_ms)`);

    // (ii) completude: campos preenchidos pela ferramenta em relação aos presentes no log
    const { rows: [cr] } = await client.query(`
      SELECT count(*)::int AS total, count(data_hora)::int AS data_hora, count(duracao_ms)::int AS duracao,
             count(NULLIF(sql, ''))::int AS texto, count(banco)::int AS banco, count(usuario)::int AS usuario,
             count(aplicacao)::int AS aplicacao, count(host_cliente)::int AS host, count(pid)::int AS pid, count(query_id)::int AS query_id
      FROM ref WHERE etapa IN ('statement', 'execute')`);
    const { rows: [ct] } = await client.query(`
      SELECT count(*)::int AS total, count(data_hora)::int AS data_hora, count(duracao_ms)::int AS duracao,
             count(NULLIF(texto_executado, ''))::int AS texto, count(banco)::int AS banco, count(usuario)::int AS usuario,
             count(aplicacao)::int AS aplicacao, count(host_cliente)::int AS host, count(pid)::int AS pid,
             count(consulta_query_id)::int AS query_id
      FROM ferramenta`);
    const { rows: [agr] } = await client.query("SELECT count(DISTINCT consulta_id)::int AS consultas FROM ferramenta");

    // sobrecarga no servidor monitorado: tempo da consulta ao pg_stat_statements usada nos snapshots
    let tempoPgss: number[] | null = null;
    if (config.monitoradoUrl) {
      try {
        const mon = new Client({ connectionString: config.monitoradoUrl, application_name: "slowquery-monitor-avaliacao" });
        await mon.connect();
        tempoPgss = [];
        for (let i = 0; i < 5; i++) {
          const t0 = process.hrtime.bigint();
          await mon.query(SQL_PG_STAT_STATEMENTS, [LIMITE_CONSULTAS]);
          tempoPgss.push(Number(process.hrtime.bigint() - t0) / 1e6);
        }
        await mon.end();
      } catch (e) {
        console.warn("não foi possível medir o pg_stat_statements:", (e as Error).message);
        tempoPgss = null;
      }
    }

    // comparação com o pgBadger
    let secaoPgbadger = "";
    let resumoPgbadger: Record<string, unknown> | null = null;
    if (arquivoPgbadger) {
      const pgb = lerPgbadger(path.resolve(arquivoPgbadger));
      const { rows: porConsulta } = await client.query<{ texto: string; n: number; total: number }>(`
        SELECT c.texto_normalizado AS texto, count(*)::int AS n, sum(f.duracao_ms)::float8 AS total
        FROM ferramenta f JOIN consulta c ON c.id = f.consulta_id GROUP BY c.texto_normalizado ORDER BY total DESC`);
      const linhas: string[] = [];
      let iguais = 0;
      const vistas = new Set<string>();
      for (const c of porConsulta) {
        const k = canonica(c.texto);
        vistas.add(k);
        const p = pgb.consultas.get(k);
        const ok = p !== undefined && p.count === c.n;
        if (ok) iguais++;
        const resumoTexto = c.texto.length > 70 ? `${c.texto.slice(0, 70)}…` : c.texto;
        linhas.push(
          `| \`${resumoTexto.replace(/\|/g, "\\|")}\` | ${c.n} | ${p ? p.count : "não encontrada"} | ${fmt(c.total / 1000)} | ${p ? fmt(p.duration / 1000) : "–"} | ${ok ? "sim" : "não"} |`,
        );
      }
      const soPgbadger = [...pgb.consultas.keys()].filter((k) => !vistas.has(k));
      resumoPgbadger = {
        ocorrencias_pgbadger: pgb.total,
        consultas_pgbadger: pgb.consultas.size,
        consultas_com_contagem_igual: iguais,
        consultas_ferramenta: porConsulta.length,
        apenas_no_pgbadger: soPgbadger.length,
      };
      secaoPgbadger = `
## Comparação com o pgBadger

| Indicador | Ferramenta | pgBadger |
| --- | ---: | ---: |
| Consultas lentas identificadas | ${ct.total} | ${pgb.total} |
| Consultas distintas (normalizadas) | ${porConsulta.length} | ${pgb.consultas.size} |
${tempoPgbadger !== null ? `| Tempo de processamento (s) | ${fmt(mediana(medicoes.map((m) => m.segundos)), 3)} (mediana) | ${fmt(tempoPgbadger, 3)} |\n` : ""}
Consultas normalizadas com o mesmo número de ocorrências nas duas ferramentas: **${iguais} de ${porConsulta.length}**.
${soPgbadger.length ? `\nConsultas presentes apenas no pgBadger (${soPgbadger.length}): ${soPgbadger.slice(0, 10).map((k) => `\`${k.slice(0, 60)}\``).join(", ")}\n` : ""}
| Consulta (ferramenta) | Ocorrências (ferramenta) | Ocorrências (pgBadger) | Tempo total (s, ferramenta) | Tempo total (s, pgBadger) | Contagem igual |
| --- | ---: | ---: | ---: | ---: | :---: |
${linhas.join("\n")}
`;
    }

    // ------------------------------------------------------------ relatório
    const seg = medicoes.map((m) => m.segundos);
    const cpu = medicoes.map((m) => m.cpuSegundos);
    const rss = medicoes.map((m) => m.rssPicoMB);
    const mbps = medicoes.map((m) => tamanho / MB / m.segundos);
    const ops = medicoes.map((m) => m.ocorrencias / m.segundos);
    const linhaTempo = (rotulo: string, v: number[], casas = 3) =>
      `| ${rotulo} | ${fmt(mediana(v), casas)} | ${fmt(Math.min(...v), casas)} a ${fmt(Math.max(...v), casas)} |`;
    const campo = (rotulo: string, k: keyof typeof cr) =>
      `| ${rotulo} | ${cr[k]} | ${ct[k]} | ${pct(Math.min(ct[k], cr[k]), cr[k])} |`;
    const agora = new Date();

    const relatorio = `# Avaliação da ferramenta

- **Data:** ${agora.toLocaleString("pt-BR")}
${cenario ? `- **Cenário:** ${cenario}\n` : ""}- **Arquivo:** \`${path.basename(caminhoLog)}\` (${formato}, ${fmt(tamanho / MB)} MB, ${ref.linhas} registros)
- **Ambiente:** ${os.cpus()[0]?.model ?? "processador desconhecido"}, ${os.cpus().length} núcleos lógicos, ${fmt(os.totalmem() / 1024 ** 3, 1)} GB de RAM, ${os.type()} ${os.release()}, Node.js ${process.version}
- **Execuções:** ${execucoes}

## Referência

Registros de duração no log, obtidos com COPY no PostgreSQL:

| Etapa | Registros | Tratamento esperado |
| --- | ---: | --- |
| statement (protocolo simples) | ${ref.etapas.statement ?? 0} | contabilizar |
| execute (protocolo estendido) | ${ref.etapas.execute ?? 0} | contabilizar |
| parse (protocolo estendido) | ${ref.etapas.parse ?? 0} | ignorar |
| bind (protocolo estendido) | ${ref.etapas.bind ?? 0} | ignorar |
| **Consultas lentas esperadas** | **${esperadas}** | |

## (i) Acurácia na identificação das consultas lentas

| Indicador | Valor |
| --- | ---: |
| Consultas lentas no log (referência) | ${esperadas} |
| Ocorrências registradas pela ferramenta | ${ct.total} |
| Corretamente detectadas | ${ac.corretas} |
| Não detectadas | ${ac.nao_detectadas} |
| Registradas indevidamente | ${ac.indevidas} |
| Registros indevidos que eram etapas parse/bind | ${ignoradas.n} |
| **Acurácia (detectadas / esperadas)** | **${pct(ac.corretas, esperadas)}** |
| Precisão (detectadas / registradas) | ${pct(ac.corretas, ct.total)} |
| Texto idêntico ao do log (protocolo simples) | ${pct(ac.texto_identico, ac.statement_pareadas)} |
| Consultas distintas após a normalização | ${agr.consultas} |

## (ii) Completude da extração dos campos

| Campo | Presente no log | Extraído pela ferramenta | Completude |
| --- | ---: | ---: | ---: |
${campo("Data e hora", "data_hora")}
${campo("Duração", "duracao")}
${campo("Texto da consulta", "texto")}
${campo("Banco de dados", "banco")}
${campo("Usuário", "usuario")}
${campo("Aplicação", "aplicacao")}
${campo("Host do cliente", "host")}
${campo("Identificador do processo (PID)", "pid")}
${campo("query_id", "query_id")}

## (iii) Tempo de processamento

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
${linhaTempo("Tempo total (s)", seg)}
${linhaTempo("Volume processado (MB/s)", mbps, 2)}
${linhaTempo("Ocorrências por segundo", ops, 0)}

## (iv) Sobrecarga

| Medida | Mediana | Faixa (mín. a máx.) |
| --- | ---: | ---: |
${linhaTempo("Tempo de CPU do coletor (s)", cpu)}
${linhaTempo("Uso de CPU (% de um núcleo)", medicoes.map((m) => (m.cpuSegundos / m.segundos) * 100), 1)}
${linhaTempo("Memória do processo, pico (MB)", rss, 1)}
${linhaTempo("Memória adicional à base do processo (MB)", rss.map((v) => v - RSS_BASE / MB), 1)}

- Memória base do processo (Node.js e bibliotecas, antes da leitura): ${fmt(RSS_BASE / MB, 1)} MB.
- O uso de CPU pode passar de 100% de um núcleo porque inclui as threads auxiliares do Node.js (leitura de arquivos e rede).
- Leitura em disco: ${fmt(tamanho / MB)} MB por execução (o arquivo é lido uma única vez, de forma sequencial).
- Armazenamento das ocorrências no banco da ferramenta: ${fmt(bytes_ocorrencias / 1024)} KB (${ct.total ? fmt(bytes_ocorrencias / ct.total, 0) : "–"} bytes por ocorrência, sem índices).
${tempoPgss ? `- Consulta ao pg_stat_statements no servidor monitorado (snapshot, até ${LIMITE_CONSULTAS} consultas): mediana de ${fmt(mediana(tempoPgss), 2)} ms em 5 execuções.` : "- Consulta ao pg_stat_statements no servidor monitorado: não medida (MONITORADO_URL não definida)."}
- O coletor não executa consultas no servidor monitorado para ler o log: os arquivos são lidos diretamente do disco.
${secaoPgbadger}`;

    const pastaResultados = path.resolve("testes", "resultados");
    mkdirSync(pastaResultados, { recursive: true });
    const dd = (n: number) => String(n).padStart(2, "0");
    const carimbo = `${agora.getFullYear()}${dd(agora.getMonth() + 1)}${dd(agora.getDate())}-${dd(agora.getHours())}${dd(agora.getMinutes())}`;
    const base = path.join(pastaResultados, `avaliacao-${carimbo}`);
    writeFileSync(`${base}.md`, relatorio);
    writeFileSync(
      `${base}.json`,
      JSON.stringify(
        { arquivo: caminhoLog, formato, tamanho, cenario, referencia: ref, acuracia: ac, completude: { referencia: cr, ferramenta: ct }, medicoes, tempoPgss, pgbadger: resumoPgbadger, tempoPgbadger },
        null,
        2,
      ),
    );
    console.log(`\n${relatorio}\nrelatório salvo em ${base}.md`);

    if (!manter) await pool().query("DELETE FROM servidor WHERE nome = 'avaliacao'");
  } finally {
    client.release();
    rmSync(dir, { recursive: true, force: true });
    await pool().end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
