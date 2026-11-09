/**
 * Cenários de avaliação no servidor de exemplo (testes/docker-compose.yml).
 *
 *   npm run cenario -- carga [segundos]     carga de exemplo (padrão 120 s, limite de 100 ms)
 *   npm run cenario -- pgbench [segundos]   pgbench no protocolo estendido registrando todas as
 *                                           instruções (log_min_duration_statement = 0, padrão 30 s)
 *   npm run cenario -- impacto [segundos]   vazão do servidor monitorado (TPS do pgbench) sem log,
 *                                           com log completo e com log completo e o coletor em execução
 *                                           (3 execuções de cada, padrão 30 s cada);
 *                                           com --limite-100, também com o limite de 100 ms
 *
 * Nos cenários carga e pgbench, apenas o trecho do log produzido durante o cenário é salvo em
 * testes/resultados/, para ser usado em seguida pelo pgBadger e pelo npm run avaliacao.
 *
 * Por padrão o pgbench é executado dentro do contêiner sqm-monitorado. Para usar um pgbench
 * instalado localmente, defina PGBENCH com o caminho do executável.
 */
import { cargaUrl } from "./ambiente";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { closeSync, mkdirSync, openSync, readdirSync, readSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Client } from "pg";
import { config } from "../../src/lib/config";
import { pool } from "../../src/lib/db";

const argumentos = process.argv.slice(2);
// --limite-100: acrescenta ao cenário impacto as configurações com limite de 100 ms (teste em Linux, Tabela 15)
const limite100 = argumentos.includes("--limite-100");
const [tipo = "", seg] = argumentos.filter((a) => !a.startsWith("--"));
if (!["carga", "pgbench", "impacto"].includes(tipo)) {
  console.error("uso: npm run cenario -- <carga|pgbench|impacto> [segundos] [--limite-100]");
  process.exit(1);
}
const segundos = Number(seg ?? (tipo === "carga" ? 120 : 30));
const dirLogs = path.resolve(config.diretorioLogs ?? "./testes/logs");
const extensao = config.formatoLog === "jsonlog" ? ".json" : ".csv";
const conexaoAdmin = cargaUrl;
const CONTEINER = "sqm-monitorado";
const windows = process.platform === "win32";

const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
const dd = (n: number) => String(n).padStart(2, "0");
const carimbo = (d = new Date()) => `${d.getFullYear()}${dd(d.getMonth() + 1)}${dd(d.getDate())}-${dd(d.getHours())}${dd(d.getMinutes())}`;
const mediana = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const fmt = (v: number, c = 1) => v.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

function arquivoAtual(): string {
  const arquivos = readdirSync(dirLogs)
    .filter((f) => f.endsWith(extensao))
    .map((f) => ({ f, m: statSync(path.join(dirLogs, f)).mtimeMs }))
    .sort((a, b) => b.m - a.m);
  if (!arquivos.length) throw new Error(`nenhum arquivo ${extensao} em ${dirLogs}`);
  return path.join(dirLogs, arquivos[0].f);
}

function executar(cmd: string, args: string[], capturar = false, env?: NodeJS.ProcessEnv): string {
  console.log(`> ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: capturar ? ["ignore", "pipe", "inherit"] : "inherit", shell: windows, encoding: "utf8", env: env ?? process.env });
  if (r.status !== 0) throw new Error(`falha ao executar ${cmd} (código ${r.status})`);
  return r.stdout ?? "";
}

/** Executa o pgbench no contêiner do servidor monitorado ou, se PGBENCH estiver definida, localmente. */
function pgbench(banco: string, args: string[], capturar = false): string {
  if (process.env.PGBENCH) {
    const u = new URL(conexaoAdmin);
    return executar(process.env.PGBENCH, ["-h", u.hostname, "-p", u.port || "5432", "-U", decodeURIComponent(u.username), ...args, banco], capturar, {
      ...process.env,
      PGPASSWORD: decodeURIComponent(u.password),
    });
  }
  return executar("docker", ["exec", CONTEINER, "pgbench", "-U", "postgres", ...args, banco], capturar);
}

/** Remove do servidor monitorado "local" as ocorrências do pgbench geradas pelo coletor durante o teste. */
async function limparOcorrenciasPgbench(desde: Date) {
  try {
    const r = await pool().query(
      `DELETE FROM ocorrencia WHERE aplicacao = 'pgbench' AND data_hora >= $1
       AND servidor_id IN (SELECT id FROM servidor WHERE nome = $2)`,
      [desde, config.servidorNome],
    );
    if (r.rowCount) console.log(`${r.rowCount} ocorrência(s) do pgbench removidas do painel`);
  } catch {
    // banco da ferramenta indisponível: nada a limpar
  }
}

async function trechoDoLog(admin: Client, banco: string) {
  await esperar(1500); // aguarda a gravação de registros anteriores
  const arquivo = arquivoAtual();
  const inicio = statSync(arquivo).size;
  const desde = new Date();
  console.log(`log: ${arquivo} (início do trecho no byte ${inicio})`);

  if (tipo === "carga") {
    executar("npx", ["tsx", "testes/scripts/carga.ts", String(segundos)]);
  } else {
    pgbench(banco, ["-i", "-s", "5", "-q"]);
    // o limite definido por banco tem precedência sobre o da linha de comando do servidor
    await admin.query(`ALTER DATABASE ${banco} SET log_min_duration_statement = 0`);
    try {
      pgbench(banco, ["-c", "4", "-j", "2", "-M", "extended", "-T", String(segundos)]);
    } finally {
      await admin.query(`ALTER DATABASE ${banco} RESET log_min_duration_statement`);
    }
  }

  await esperar(1500);
  if (arquivoAtual() !== arquivo) console.warn("atenção: o arquivo de log foi rotacionado durante o cenário; o trecho pode estar incompleto");
  const fim = statSync(arquivo).size;
  const buf = Buffer.alloc(fim - inicio);
  const fd = openSync(arquivo, "r");
  readSync(fd, buf, 0, buf.length, inicio);
  closeSync(fd);
  if (tipo === "pgbench") await limparOcorrenciasPgbench(desde);

  const pasta = path.resolve("testes", "resultados");
  mkdirSync(pasta, { recursive: true });
  const nome = `cenario-${tipo}-${carimbo()}${extensao}`;
  writeFileSync(path.join(pasta, nome), buf);
  const formato = extensao === ".csv" ? "csv" : "jsonlog";
  const json = nome.replace(/\.(csv|json)$/, ".pgbadger.json");
  console.log(`
trecho do log salvo em testes/resultados/${nome} (${(buf.length / 1024 / 1024).toFixed(2)} MB)

próximos passos:
  docker compose -f testes/docker-compose.yml run --rm pgbadger -q -f ${formato} -x json -o /resultados/${json} /resultados/${nome}
  npm run avaliacao -- testes/resultados/${nome} --pgbadger testes/resultados/${json} --tempo-pgbadger <tempo informado pelo pgBadger>
`);
}

async function impacto(admin: Client, banco: string) {
  const REPETICOES = 3;
  pgbench(banco, ["-i", "-s", "5", "-q"]);
  const configuracoes = [
    { nome: "Sem registro de consultas (log_min_duration_statement = -1)", limite: "-1", coletor: false },
    { nome: "Registro de todas as consultas (log_min_duration_statement = 0)", limite: "0", coletor: false },
    { nome: "Registro de todas as consultas e coletor em execução", limite: "0", coletor: true },
    ...(limite100
      ? [
          { nome: "Limite de 100 ms (log_min_duration_statement = 100)", limite: "100", coletor: false },
          { nome: "Limite de 100 ms e coletor em execução", limite: "100", coletor: true },
        ]
      : []),
  ];
  const resultados: { nome: string; tps: number[] }[] = [];
  const desde = new Date();

  for (const c of configuracoes) {
    await admin.query(`ALTER DATABASE ${banco} SET log_min_duration_statement = ${c.limite}`);
    let coletor: ChildProcess | null = null;
    try {
      if (c.coletor) {
        coletor = spawn("npx", ["tsx", "testes/scripts/coletor.ts"], { stdio: "ignore", shell: windows, detached: !windows });
        await esperar(5000);
      }
      const tps: number[] = [];
      for (let i = 1; i <= REPETICOES; i++) {
        const saida = pgbench(banco, ["-c", "4", "-j", "2", "-M", "extended", "-T", String(segundos)], true);
        const m = saida.match(/tps = ([\d.]+)/);
        if (!m) throw new Error("não foi possível ler o TPS do pgbench");
        tps.push(Number(m[1]));
        console.log(`${c.nome}, execução ${i}/${REPETICOES}: ${fmt(Number(m[1]))} TPS`);
      }
      resultados.push({ nome: c.nome, tps });
    } finally {
      if (coletor?.pid) {
        if (windows) spawnSync("taskkill", ["/pid", String(coletor.pid), "/T", "/F"]);
        else process.kill(-coletor.pid, "SIGINT");
      }
      await admin.query(`ALTER DATABASE ${banco} RESET log_min_duration_statement`);
    }
  }
  await esperar(3000);
  await limparOcorrenciasPgbench(desde);

  const base = mediana(resultados[0].tps);
  const linhas = resultados.map((r) => {
    const m = mediana(r.tps);
    return `| ${r.nome} | ${fmt(m)} | ${fmt(Math.min(...r.tps))} a ${fmt(Math.max(...r.tps))} | ${fmt(((m - base) / base) * 100)}% |`;
  });
  const relatorio = `# Impacto no servidor monitorado

- **Data:** ${new Date().toLocaleString("pt-BR")}
- **Carga:** pgbench (TPC-B), protocolo estendido, 4 clientes, ${segundos} s por execução, ${REPETICOES} execuções por configuração, escala 5

| Configuração | TPS (mediana) | Faixa | Variação em relação a sem registro |
| --- | ---: | ---: | ---: |
${linhas.join("\n")}

A diferença entre a segunda e a terceira linha corresponde ao efeito do coletor sobre o servidor monitorado;
a diferença entre a primeira e a segunda, ao custo do próprio registro em log pelo PostgreSQL.
`;
  const pasta = path.resolve("testes", "resultados");
  mkdirSync(pasta, { recursive: true });
  const arquivo = path.join(pasta, `impacto-${windows ? "" : "linux-"}${carimbo()}.md`);
  writeFileSync(arquivo, relatorio);
  console.log(`\n${relatorio}\nrelatório salvo em ${arquivo}`);
}

async function main() {
  const admin = new Client({ connectionString: conexaoAdmin });
  await admin.connect();
  const banco = (await admin.query("SELECT current_database() AS b")).rows[0].b as string;
  try {
    if (tipo === "impacto") await impacto(admin, banco);
    else await trechoDoLog(admin, banco);
  } finally {
    await admin.end();
    await pool().end().catch(() => {});
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
