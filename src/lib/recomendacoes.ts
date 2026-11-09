import { formatarDuracao, formatarNumero } from "./formato";

/**
 * Diagnóstico automático de uma consulta lenta. As regras combinam três fontes: o texto da
 * consulta (normalizado e executado), as estatísticas das ocorrências registradas no log e,
 * quando disponíveis, os contadores do pg_stat_statements. Cada recomendação traz a evidência
 * encontrada e a ação sugerida; como o log não contém o plano de execução, as recomendações são
 * hipóteses a confirmar com EXPLAIN.
 */

/** Prioridade do problema encontrado; "verificacao" marca o passo de confirmação, fora dessa escala. */
export type Severidade = "alta" | "media" | "baixa" | "verificacao";

export interface Recomendacao {
  id: string;
  severidade: Severidade;
  titulo: string;
  /** o que foi encontrado nos dados */
  evidencia: string;
  /** como resolver */
  acao: string;
  /** comando de exemplo */
  sql?: string;
}

export interface DadosDiagnostico {
  /** consulta normalizada */
  texto: string;
  /** texto executado de uma ocorrência, com os valores dos parâmetros (de preferência a mais lenta) */
  exemplo?: string | null;
  ocorrencias: number;
  tempo_total_ms: number;
  media_ms: number;
  mediana_ms?: number | null;
  p95_ms: number;
  max_ms: number;
  /** fração do tempo total de todas as consultas lentas do mesmo escopo (0 a 1) */
  participacao?: number | null;
  /** intervalo, em segundos, entre a primeira e a última ocorrência */
  duracao_periodo_s?: number | null;
  /** razão entre a duração média do último e a do primeiro terço das ocorrências */
  tendencia?: number | null;
  pgss?: {
    calls: number;
    mean_exec_time: number;
    rows: number;
    shared_blks_hit: number;
    shared_blks_read: number;
  } | null;
}

const ORDEM: Record<Severidade, number> = { alta: 0, media: 1, baixa: 2, verificacao: 3 };
const pct = (v: number) => `${(v * 100).toLocaleString("pt-BR", { maximumFractionDigits: v < 0.1 ? 1 : 0 })}%`;
const vezes = (v: number) => `${v.toLocaleString("pt-BR", { maximumFractionDigits: 1 })} vezes`;

// ---------------------------------------------------------------------------------------------
// Análise do texto SQL
// ---------------------------------------------------------------------------------------------

/** Remove os textos entre aspas simples (mantendo as aspas), para não confundir valores com SQL. */
function semTextos(sql: string): string {
  return sql.replace(/'(?:[^']|'')*'/g, "''");
}

/** Substitui por espaços o conteúdo entre parênteses, deixando visível apenas o nível principal. */
function nivelPrincipal(sql: string): string {
  let nivel = 0;
  let out = "";
  for (const c of sql) {
    if (c === "(") {
      out += nivel === 0 ? "(" : " ";
      nivel++;
    } else if (c === ")") {
      nivel = Math.max(0, nivel - 1);
      out += nivel === 0 ? ")" : " ";
    } else out += nivel > 0 ? " " : c;
  }
  return out;
}

const FIM_CLAUSULA = String.raw`\b(?:WHERE|GROUP\s+BY|ORDER\s+BY|LIMIT|OFFSET|HAVING|FOR\s+(?:UPDATE|SHARE|NO\s+KEY|KEY)|RETURNING|WINDOW|UNION|INTERSECT|EXCEPT|FETCH|SET|VALUES|ON\s+CONFLICT)\b`;

/** Trecho de uma cláusula do nível principal (ex.: WHERE ... até a próxima cláusula). */
function clausula(principal: string, original: string, inicio: string, fim = FIM_CLAUSULA): string | null {
  const m = new RegExp(String.raw`\b${inicio}\b`, "i").exec(principal);
  if (!m) return null;
  const de = m.index + m[0].length;
  const resto = principal.slice(de);
  const f = new RegExp(fim, "i").exec(resto);
  return original.slice(de, f ? de + f.index : undefined).trim();
}

const RESERVADAS = new Set(
  ("where join left right inner outer full cross natural on using group order limit offset having window union " +
    "intersect except set values returning for lateral select as and or not tablesample fetch only")
    .split(" "),
);

const ident = (s: string) => s.replace(/"/g, "");

interface Estrutura {
  tipo: string;
  tabelas: { nome: string; alias: string | null }[];
  where: string | null;
  orderBy: string | null;
  temJoin: boolean;
  temLimit: boolean;
  temGroupBy: boolean;
  listaSelect: string | null;
  principal: string;
  original: string;
}

function analisarEstrutura(sql: string): Estrutura {
  const original = semTextos(sql);
  let principal = nivelPrincipal(original);
  let base = original;
  const ctes = new Set<string>();
  for (const m of principal.matchAll(/(?:\bWITH(?:\s+RECURSIVE)?|,)\s*([\w"]+)\s+AS\s+(?:(?:NOT\s+)?MATERIALIZED\s+)?\(/gi)) ctes.add(ident(m[1]));
  // WITH ...: analisa a instrução principal, depois das CTEs
  if (/^\s*WITH\b/i.test(principal)) {
    const m = /\)\s*(SELECT|INSERT|UPDATE|DELETE)\b(?![\s\S]*\)\s*,\s*\w+\s+AS\s*\()/i.exec(principal);
    if (m) {
      const de = m.index + m[0].length - m[1].length;
      principal = principal.slice(de);
      base = original.slice(de);
    }
  }
  const tipo = (/^\s*(\w+)/.exec(principal)?.[1] ?? "").toUpperCase();
  const tabelas: Estrutura["tabelas"] = [];
  const adicionar = (trecho: string) => {
    const m = /^\s*(ONLY\s+)?([\w."]+)(?:\s+(?:AS\s+)?([\w"]+))?/i.exec(trecho);
    if (!m || m[2].startsWith("(") || ctes.has(ident(m[2]))) return;
    const alias = m[3] && !RESERVADAS.has(m[3].toLowerCase()) ? ident(m[3]) : null;
    tabelas.push({ nome: ident(m[2]), alias });
  };

  if (tipo === "UPDATE") {
    const m = /^\s*UPDATE\s+(?:ONLY\s+)?([\w."]+)(?:\s+(?:AS\s+)?(\w+))?\s+SET\b/i.exec(principal);
    if (m) tabelas.push({ nome: ident(m[1]), alias: m[2] && !RESERVADAS.has(m[2].toLowerCase()) ? m[2] : null });
  } else if (tipo === "INSERT") {
    const m = /^\s*INSERT\s+INTO\s+([\w."]+)/i.exec(principal);
    if (m) tabelas.push({ nome: ident(m[1]), alias: null });
  }
  const from = clausula(principal, base, "FROM");
  const temJoin = from !== null && /\bJOIN\b/i.test(nivelPrincipal(from));
  if (from !== null && tipo !== "INSERT") {
    // separa os itens do FROM pelas vírgulas e pelos JOIN do nível principal
    const nivel = nivelPrincipal(from);
    const cortes = [0];
    const re = /,|\b(?:(?:NATURAL\s+)?(?:LEFT|RIGHT|FULL|INNER|CROSS)\s+(?:OUTER\s+)?)?JOIN\b(?:\s+LATERAL\b)?/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(nivel))) cortes.push(m.index, m.index + m[0].length);
    cortes.push(from.length);
    for (let i = 0; i < cortes.length; i += 2) adicionar(from.slice(cortes[i], cortes[i + 1]));
  }
  const where = clausula(principal, base, "WHERE");
  const orderBy = clausula(principal, base, String.raw`ORDER\s+BY`, String.raw`\b(?:LIMIT|OFFSET|FOR\s+\w+|FETCH|WINDOW|UNION|RETURNING)\b`);
  const listaSelect = tipo === "SELECT" ? clausula(principal, base, "SELECT", String.raw`\bFROM\b`) : null;
  return {
    tipo,
    tabelas,
    where,
    orderBy,
    temJoin,
    temLimit: /\b(LIMIT|FETCH\s+(FIRST|NEXT))\b/i.test(principal),
    temGroupBy: /\bGROUP\s+BY\b/i.test(principal),
    listaSelect,
    principal,
    original: base,
  };
}

/** Resolve "alias.coluna" ou "coluna" para a tabela correspondente. */
function resolver(coluna: string, e: Estrutura): { tabela: string; coluna: string } | null {
  const partes = ident(coluna).split(".");
  const nome = partes[partes.length - 1];
  if (!/^[a-z_][\w$]*$/i.test(nome) || RESERVADAS.has(nome.toLowerCase())) return null;
  if (partes.length >= 2) {
    const q = partes[partes.length - 2];
    const t = e.tabelas.find((t) => t.alias === q || t.nome === q || t.nome.endsWith(`.${q}`));
    return t ? { tabela: t.nome, coluna: nome } : null;
  }
  return e.tabelas.length === 1 ? { tabela: e.tabelas[0].nome, coluna: nome } : null;
}

const COL = String.raw`((?:"[^"]+"|[a-z_][\w$]*)(?:\.(?:"[^"]+"|[a-z_][\w$]*))?)`;
const VALOR = String.raw`(?:\$\d+|''|-?\d+(?:\.\d+)?|ANY\s*\(|now\s*\(|current_\w+)`;

function colunasDoFiltro(where: string) {
  const nivel = nivelPrincipal(where);
  const iguais: string[] = [];
  const faixas: string[] = [];
  const achar = (re: RegExp, destino: string[], grupo = 1) => {
    for (const m of nivel.matchAll(re)) destino.push(m[grupo]);
  };
  achar(new RegExp(String.raw`${COL}\s*=\s*${VALOR}`, "gi"), iguais);
  achar(new RegExp(String.raw`${VALOR}\s*=\s*${COL}(?!\s*\()`, "gi"), iguais);
  achar(new RegExp(String.raw`${COL}\s+IN\s*\(`, "gi"), iguais);
  achar(new RegExp(String.raw`${COL}\s+IS\s+(?:NOT\s+)?NULL`, "gi"), iguais);
  achar(new RegExp(String.raw`${COL}\s*(?:<=|>=|<|>)\s*${VALOR}`, "gi"), faixas);
  achar(new RegExp(String.raw`${COL}\s+BETWEEN\b`, "gi"), faixas);
  const naoNot = (c: string) => !/^not$/i.test(c);
  return { iguais: [...new Set(iguais.filter(naoNot))], faixas: [...new Set(faixas.filter(naoNot))] };
}

function colunasDaOrdenacao(orderBy: string | null): string[] {
  if (!orderBy) return [];
  return nivelPrincipal(orderBy)
    .split(",")
    .map((s) => s.trim().replace(/\s+(ASC|DESC)\b.*$/i, "").replace(/\s+NULLS\s+\w+$/i, ""))
    .filter((s) => new RegExp(`^${COL}$`, "i").test(s));
}

/** Índice composto candidato: igualdades, depois a ordenação ou uma faixa (regra usual para B-tree). */
function indiceCandidato(e: Estrutura) {
  if (!e.where) return null;
  const { iguais, faixas } = colunasDoFiltro(e.where);
  const porTabela = new Map<string, { iguais: string[]; faixas: string[]; ordem: string[] }>();
  const grupo = (t: string) => {
    if (!porTabela.has(t)) porTabela.set(t, { iguais: [], faixas: [], ordem: [] });
    return porTabela.get(t)!;
  };
  for (const c of iguais) { const r = resolver(c, e); if (r) grupo(r.tabela).iguais.push(r.coluna); }
  for (const c of faixas) { const r = resolver(c, e); if (r) grupo(r.tabela).faixas.push(r.coluna); }
  const ordem = colunasDaOrdenacao(e.orderBy).map((c) => resolver(c, e));
  if (ordem.length && ordem.every((r) => r && r.tabela === ordem[0]!.tabela)) grupo(ordem[0]!.tabela).ordem = ordem.map((r) => r!.coluna);
  const candidatos: { tabela: string; colunas: string[]; filtros: string[]; ordem: string[] }[] = [];
  for (const [tabela, g] of porTabela) {
    const iguaisU = [...new Set(g.iguais)];
    const faixasU = [...new Set(g.faixas)].filter((c) => !iguaisU.includes(c));
    if (iguaisU.length + faixasU.length === 0) continue;
    // uma busca apenas pela chave primária já usa índice
    if (iguaisU.length === 1 && iguaisU[0] === "id" && faixasU.length === 0) continue;
    const colunas = [...iguaisU];
    const ordemValida = g.ordem.length > 0 && (faixasU.length === 0 || faixasU[0] === g.ordem[0]) && e.temLimit;
    if (ordemValida) colunas.push(...g.ordem.filter((c) => !colunas.includes(c)));
    else if (faixasU.length) colunas.push(faixasU[0]);
    const candidato = { tabela, colunas: colunas.slice(0, 4), filtros: [...iguaisU, ...faixasU], ordem: ordemValida ? g.ordem : [] };
    candidatos.push(candidato);
  }
  return candidatos.sort((a, b) => b.filtros.length - a.filtros.length).slice(0, 3);
}

const lista = (itens: string[]) => (itens.length <= 1 ? itens.join("") : `${itens.slice(0, -1).join(", ")} e ${itens[itens.length - 1]}`);

function regrasDoTexto(d: DadosDiagnostico): Recomendacao[] {
  const r: Recomendacao[] = [];
  const e = analisarEstrutura(d.texto);
  const exemplo = d.exemplo ?? null;
  const ex = exemplo ? analisarEstrutura(exemplo) : null;
  const tabela = e.tabelas[0]?.nome ?? "tabela";

  // operações de manutenção e carga: demoram por natureza
  if (/^(VACUUM|ANALYZE|CREATE|REINDEX|CLUSTER|REFRESH|COPY|ALTER|DROP|TRUNCATE|GRANT|REVOKE)$/.test(e.tipo)) {
    const concorrente = /^(CREATE|REINDEX|REFRESH)$/.test(e.tipo);
    r.push({
      id: "manutencao",
      severidade: "baixa",
      titulo: "Operação de manutenção ou carga de dados",
      evidencia: `A instrução ${e.tipo} não é uma consulta da aplicação; operações desse tipo costumam demorar pelo volume de dados que processam.`,
      acao: concorrente
        ? "Agende-a fora do horário de maior uso e prefira a variante CONCURRENTLY, que não bloqueia leituras e escritas na tabela durante a execução."
        : "Agende-a fora do horário de maior uso. Se ela ocorre com frequência, verifique se pode ser feita com menos dados de cada vez ou substituída pelo autovacuum.",
    });
    return r;
  }

  if (/^(COMMIT|END)$/i.test(d.texto.trim())) {
    r.push({
      id: "commit",
      severidade: "media",
      titulo: "Confirmação de transação lenta",
      evidencia: "O tempo é gasto no COMMIT, que aguarda a gravação do WAL em disco.",
      acao:
        "Verifique a latência de escrita do disco onde fica o WAL e a frequência dos checkpoints (aumente max_wal_size e use checkpoint_completion_target = 0.9). " +
        "Para dados que toleram perder as últimas transações em caso de queda, synchronous_commit = off na sessão elimina a espera.",
    });
    return r;
  }

  // UPDATE e DELETE
  if ((e.tipo === "UPDATE" || e.tipo === "DELETE") && !e.where) {
    r.push({
      id: "dml-sem-where",
      severidade: "alta",
      titulo: `${e.tipo} sem WHERE: altera a tabela inteira`,
      evidencia: `A instrução ${e.tipo} em ${tabela} não tem condição e processa todas as linhas.`,
      acao:
        e.tipo === "DELETE"
          ? "Para esvaziar a tabela, use TRUNCATE, que é imediato. Se a intenção é apagar parte dos dados, adicione a condição e processe em lotes menores para reduzir bloqueios e o volume de WAL."
          : "Confira se a condição foi omitida por engano. Para atualizações em massa, processe em lotes (por exemplo, por faixas de id) para reduzir bloqueios e o inchaço da tabela.",
    });
  }
  if (e.tipo === "DELETE" && e.where) {
    r.push({
      id: "delete-fk",
      severidade: "baixa",
      titulo: "Exclusão: verifique os índices das chaves estrangeiras",
      evidencia: `Ao excluir de ${tabela}, o PostgreSQL procura as linhas que a referenciam em outras tabelas. Sem índice na coluna da chave estrangeira, cada exclusão lê a tabela referenciadora inteira.`,
      acao: "Liste as chaves estrangeiras que apontam para a tabela e não têm índice, e crie um índice na coluna de cada uma.",
      sql:
        `SELECT conrelid::regclass AS tabela, conname, pg_get_constraintdef(oid)\nFROM pg_constraint c\nWHERE contype = 'f' AND confrelid = '${tabela}'::regclass\n` +
        `  AND NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.conrelid\n` +
        `                  AND (i.indkey::int2[])[0:array_length(c.conkey, 1) - 1] @> c.conkey);`,
    });
  }
  if (e.tipo === "INSERT" && /\bVALUES\b/i.test(e.principal) && !/\/\*, \.\.\. \*\//.test(d.texto)) {
    const frequente = d.ocorrencias >= 100;
    r.push({
      id: "insert",
      severidade: frequente ? "media" : "baixa",
      titulo: frequente ? "Muitas inserções individuais" : "Inserção lenta",
      evidencia: frequente
        ? `Foram registradas ${formatarNumero(d.ocorrencias)} inserções lentas de uma linha por vez em ${tabela}.`
        : `Uma inserção de uma linha em ${tabela} ultrapassou o limite, o que indica custo fora da própria gravação.`,
      acao:
        "Cada índice, gatilho e chave estrangeira da tabela é atualizado ou verificado a cada linha: remova índices sem uso (idx_scan = 0 em pg_stat_user_indexes) e revise os gatilhos. " +
        (frequente
          ? "Agrupe as inserções em um único INSERT com várias linhas ou use COPY, e faça várias inserções na mesma transação."
          : "Se a duração varia, a inserção pode estar esperando bloqueios de outras transações."),
    });
  }

  // curingas e buscas por texto (precisam dos valores: usa o texto executado)
  const textoComValores = exemplo ?? "";
  const like = new RegExp(String.raw`${COL}\s+(NOT\s+)?(I?LIKE)\s+(?:E)?'(%?)`, "i").exec(textoComValores);
  const ilikeNorm = /\bILIKE\b/i.exec(d.texto);
  if (like || ilikeNorm) {
    const col = like ? resolver(like[1], ex ?? e) : null;
    const nomeTab = col?.tabela ?? tabela;
    const nomeCol = col?.coluna ?? "coluna";
    const comeca = like?.[4] === "%";
    const ilike = like ? like[3].toUpperCase() === "ILIKE" : true;
    if (comeca || ilike) {
      r.push({
        id: "like-curinga",
        severidade: comeca ? "alta" : "media",
        titulo: comeca ? "Busca com curinga no início do texto" : "Busca com ILIKE",
        evidencia: comeca
          ? `A condição ${like![1]} ${like![3].toUpperCase()} '%...' começa com curinga, o que impede o uso de índices B-tree: a tabela é lida linha a linha.`
          : "ILIKE (comparação sem distinção de maiúsculas) não usa índices B-tree comuns.",
        acao:
          "Crie um índice trigram com a extensão pg_trgm, que atende LIKE e ILIKE com curinga em qualquer posição. " +
          "Se a busca é por palavras inteiras, a busca textual do PostgreSQL (tsvector com índice GIN) é ainda mais eficiente.",
        sql: `CREATE EXTENSION IF NOT EXISTS pg_trgm;\nCREATE INDEX CONCURRENTLY ON ${nomeTab} USING gin (${nomeCol} gin_trgm_ops);`,
      });
    } else if (like && !like[2]) {
      r.push({
        id: "like-prefixo",
        severidade: "baixa",
        titulo: "Busca por prefixo com LIKE",
        evidencia: `A condição ${like[1]} LIKE '...%' busca por prefixo. Com collation diferente de C, o índice B-tree comum não é usado para LIKE.`,
        acao: "Crie o índice com a classe de operadores text_pattern_ops, que permite usar o índice em buscas por prefixo.",
        sql: `CREATE INDEX CONCURRENTLY ON ${nomeTab} (${nomeCol} text_pattern_ops);`,
      });
    }
  }

  // funções aplicadas às colunas do filtro
  const whereOriginal = e.where ?? "";
  const funcao = new RegExp(String.raw`\b(lower|upper|trim|date|date_trunc|to_char|coalesce|extract|substring|substr|unaccent)\s*\(\s*(?:\$\d+\s*,\s*|''\s*,\s*|\w+\s+FROM\s+)?${COL}`, "i").exec(whereOriginal);
  const conversao = new RegExp(String.raw`${COL}\s*::\s*(date|text|varchar|integer|int|bigint|numeric|timestamp)`, "i").exec(whereOriginal);
  if (funcao || conversao) {
    const nomeFn = (funcao?.[1] ?? `::${conversao![2]}`).toLowerCase();
    const colTexto = funcao?.[2] ?? conversao![1];
    if (!/^\$/.test(colTexto)) {
      const res = resolver(colTexto, e);
      const nomeTab = res?.tabela ?? tabela;
      const nomeCol = res?.coluna ?? ident(colTexto);
      const data = /^(date|date_trunc|extract|to_char|::date|::timestamp)$/.test(nomeFn);
      r.push({
        id: "funcao-coluna",
        severidade: "media",
        titulo: "Função aplicada à coluna do filtro",
        evidencia: `O filtro usa ${funcao ? `${nomeFn}(${colTexto})` : `${colTexto}${nomeFn}`}. Um índice na coluna ${nomeCol} não é usado quando a coluna é transformada antes da comparação.`,
        acao: data
          ? "Reescreva a condição como uma faixa sobre a coluna original, que permite usar o índice da coluna."
          : "Crie um índice sobre a mesma expressão usada no filtro, ou compare a coluna sem transformá-la.",
        sql: data
          ? `-- em vez de ${funcao ? `${nomeFn}(${nomeCol})` : `${nomeCol}${nomeFn}`} = $1:\nWHERE ${nomeCol} >= $1 AND ${nomeCol} < $1 + interval '1 day'`
          : `CREATE INDEX CONCURRENTLY ON ${nomeTab} ((${funcao ? `${nomeFn}(${nomeCol})` : `${nomeCol}${nomeFn}`}));`,
      });
    }
  }

  // ORDER BY random()
  if (/\bORDER\s+BY\s+random\s*\(\s*\)/i.test(d.texto)) {
    r.push({
      id: "order-random",
      severidade: "alta",
      titulo: "Ordenação aleatória com ORDER BY random()",
      evidencia: "ORDER BY random() gera um valor para cada linha e ordena a tabela inteira para devolver poucas linhas.",
      acao: "Use TABLESAMPLE para amostras aproximadas, ou sorteie valores de id no intervalo existente e busque-os pela chave primária.",
      sql: `SELECT * FROM ${tabela} TABLESAMPLE SYSTEM (1) LIMIT 10;`,
    });
  }

  // paginação por OFFSET
  const offset = /\bOFFSET\s+(\d+)/i.exec(textoComValores);
  if (offset && Number(offset[1]) >= 1000) {
    r.push({
      id: "offset",
      severidade: Number(offset[1]) >= 10000 ? "alta" : "media",
      titulo: "Paginação com OFFSET alto",
      evidencia: `Com OFFSET ${formatarNumero(Number(offset[1]))}, o banco lê e descarta essa quantidade de linhas antes de devolver a página. Quanto mais avançada a página, mais lenta a consulta.`,
      acao: "Use paginação por chave (keyset): guarde os valores da última linha da página e filtre a partir deles, com um índice nas colunas da ordenação.",
      sql: "-- ordenação por (criado_em, id):\nWHERE (criado_em, id) < ($ultimo_criado_em, $ultimo_id)\nORDER BY criado_em DESC, id DESC\nLIMIT 50",
    });
  }

  // NOT IN (subconsulta)
  if (/\bNOT\s+IN\s*\(\s*SELECT\b/i.test(d.texto)) {
    r.push({
      id: "not-in",
      severidade: "media",
      titulo: "NOT IN com subconsulta",
      evidencia: "NOT IN (SELECT ...) não pode ser convertido em anti-join e, se a subconsulta devolver muitas linhas, é executado como um laço muito custoso. Também retorna vazio se houver algum NULL na subconsulta.",
      acao: "Reescreva com NOT EXISTS, que o PostgreSQL executa como anti-join usando os índices da subconsulta.",
      sql: "WHERE NOT EXISTS (SELECT 1 FROM outra o WHERE o.chave = t.chave)",
    });
  }

  // listas IN muito grandes
  const listaIn = /\bIN\s*\(([^()]*)\)/gi;
  let maiorLista = 0;
  for (const m of textoComValores.matchAll(listaIn)) maiorLista = Math.max(maiorLista, m[1].split(",").length);
  if (maiorLista > 100) {
    r.push({
      id: "in-grande",
      severidade: "media",
      titulo: "Lista IN com muitos valores",
      evidencia: `Uma ocorrência tem uma lista IN com ${formatarNumero(maiorLista)} valores. Listas longas aumentam o tempo de análise e de planejamento, e cada tamanho diferente gera um plano diferente.`,
      acao: "Envie os valores como um único parâmetro do tipo array, ou carregue-os em uma tabela temporária e faça a junção.",
      sql: "WHERE id = ANY($1::bigint[])",
    });
  }

  // subconsulta correlacionada na lista do SELECT
  if (e.listaSelect && /\(\s*SELECT\b/i.test(e.listaSelect)) {
    r.push({
      id: "subconsulta-select",
      severidade: "media",
      titulo: "Subconsulta executada para cada linha",
      evidencia: "Há uma subconsulta na lista de colunas do SELECT, que é executada uma vez para cada linha do resultado.",
      acao: "Reescreva como junção (com GROUP BY, se for agregação) ou LEFT JOIN LATERAL, e garanta que a coluna usada para relacionar as tabelas tenha índice.",
    });
  }

  // leitura da tabela inteira
  if (e.tipo === "SELECT" && e.tabelas.length > 0 && !e.where) {
    const contagem = /^\s*count\s*\(\s*\*\s*\)\s*$/i.test(e.listaSelect ?? "");
    const agregacao = e.temGroupBy || /\b(count|sum|avg|min|max)\s*\(/i.test(nivelPrincipal(e.listaSelect ?? ""));
    if (contagem && !e.temJoin) {
      r.push({
        id: "count-total",
        severidade: "media",
        titulo: "Contagem de todas as linhas da tabela",
        evidencia: `count(*) sem filtro em ${tabela}: por causa do controle de concorrência (MVCC), o PostgreSQL precisa percorrer a tabela, ou um índice inteiro, para contar as linhas.`,
        acao: "Se um valor aproximado é suficiente, use a estimativa mantida pelo próprio banco. Se o valor exato é necessário com frequência, mantenha um contador atualizado por gatilho ou guarde o resultado em cache.",
        sql: `SELECT reltuples::bigint AS estimativa FROM pg_class WHERE oid = '${tabela}'::regclass;`,
      });
    } else if (agregacao) {
      r.push({
        id: "agregacao-total",
        severidade: "media",
        titulo: "Agregação sobre a tabela inteira",
        evidencia: "A consulta agrega dados sem nenhum filtro, ou seja, lê todas as linhas a cada execução.",
        acao: "Se o resultado não precisa estar atualizado ao segundo, guarde-o em uma visão materializada atualizada periodicamente. Se só o período recente interessa, filtre por uma coluna de data com índice.",
        sql: `CREATE MATERIALIZED VIEW resumo AS <esta consulta>;\nREFRESH MATERIALIZED VIEW CONCURRENTLY resumo; -- requer um índice único na visão`,
      });
    } else if (!e.temLimit) {
      r.push({
        id: "sem-filtro",
        severidade: "media",
        titulo: "Leitura de todas as linhas, sem filtro nem limite",
        evidencia: "A consulta não tem WHERE nem LIMIT e devolve a tabela inteira, cujo tempo cresce junto com a tabela.",
        acao: "Filtre apenas as linhas necessárias ou pagine o resultado. Se o objetivo é exportar os dados, COPY é mais eficiente.",
      });
    }
  }

  // índice composto candidato
  const indices = indiceCandidato(e) ?? [];
  if (indices.length && (e.tipo === "SELECT" || e.tipo === "UPDATE" || e.tipo === "DELETE")) {
    const partes = indices.map((i) => `${i.tabela} por ${lista(i.filtros)}${i.ordem.length ? ` (e ordena por ${lista(i.ordem)})` : ""}`);
    r.push({
      id: "indice",
      severidade: "media",
      titulo: `Índice para os filtros em ${lista(indices.map((i) => i.tabela))}`,
      evidencia: `A consulta filtra ${lista(partes)}. Sem um índice que comece por essas colunas, o PostgreSQL lê a tabela inteira (Seq Scan).`,
      acao:
        "Se ainda não houver um índice equivalente (confira com \\d na tabela), crie o índice abaixo; com mais de uma coluna, as de igualdade vêm primeiro. " +
        "CONCURRENTLY evita bloquear as escritas durante a criação. Depois confirme no EXPLAIN que o plano passou a usar Index Scan.",
      sql: indices.map((i) => `CREATE INDEX CONCURRENTLY ON ${i.tabela} (${i.colunas.join(", ")});`).join("\n"),
    });
  }

  // colunas de junção
  if (e.temJoin) {
    const juncoes = new Set<string>();
    for (const m of e.original.matchAll(new RegExp(String.raw`${COL}\s*=\s*${COL}`, "gi"))) {
      for (const c of [m[1], m[2]]) {
        const res = resolver(c, e);
        if (res && res.coluna !== "id" && c.includes(".")) juncoes.add(`${res.tabela}.${res.coluna}`);
      }
    }
    if (juncoes.size) {
      const itens = [...juncoes].slice(0, 4);
      r.push({
        id: "juncao",
        severidade: "baixa",
        titulo: "Índices nas colunas de junção",
        evidencia: `A consulta relaciona tabelas pelas colunas ${lista(itens)}. Chaves estrangeiras não recebem índice automaticamente no PostgreSQL.`,
        acao: "Garanta que essas colunas tenham índice, principalmente na tabela com mais linhas, para que a junção não precise ler a tabela inteira.",
        sql: itens.map((c) => { const [t, col] = [c.slice(0, c.lastIndexOf(".")), c.slice(c.lastIndexOf(".") + 1)]; return `CREATE INDEX CONCURRENTLY ON ${t} (${col});`; }).join("\n"),
      });
    }
  }

  // DISTINCT com junção
  if (e.temJoin && /^\s*DISTINCT\b/i.test(e.listaSelect ?? "")) {
    r.push({
      id: "distinct-join",
      severidade: "baixa",
      titulo: "DISTINCT para remover duplicatas da junção",
      evidencia: "A consulta usa DISTINCT junto com JOIN, o que costuma indicar linhas duplicadas pela junção, que depois são ordenadas e eliminadas.",
      acao: "Se a outra tabela serve apenas para filtrar, troque o JOIN por EXISTS, que não gera duplicatas.",
    });
  }

  // SELECT *
  if (e.tipo === "SELECT" && /(^|,)\s*(\w+\.)?\*\s*(,|$)/.test(e.listaSelect ?? "") && !/count\s*\(\s*\*\s*\)/i.test(e.listaSelect ?? "")) {
    r.push({
      id: "select-asterisco",
      severidade: "baixa",
      titulo: "SELECT * traz todas as colunas",
      evidencia: "A consulta lê todas as colunas, inclusive as que a aplicação talvez não use.",
      acao: "Liste apenas as colunas necessárias: isso reduz os dados lidos e transferidos, principalmente com colunas grandes (texto, JSON), e permite Index Only Scan quando um índice contém todas as colunas pedidas.",
    });
  }

  return r;
}

// ---------------------------------------------------------------------------------------------
// Regras das estatísticas
// ---------------------------------------------------------------------------------------------

function regrasDasEstatisticas(d: DadosDiagnostico): Recomendacao[] {
  const r: Recomendacao[] = [];
  const e = analisarEstrutura(d.texto);
  const tabela = e.tabelas[0]?.nome;
  const centro = d.mediana_ms ?? d.media_ms;
  const variacao = centro > 0 ? d.p95_ms / centro : 1;

  if (d.participacao !== null && d.participacao !== undefined && d.participacao >= 0.2 && d.ocorrencias > 1) {
    r.push({
      id: "impacto",
      severidade: "alta",
      titulo: "Maior impacto no tempo total",
      evidencia: `Esta consulta responde por ${pct(d.participacao)} do tempo gasto com consultas lentas (${formatarDuracao(d.tempo_total_ms)} em ${formatarNumero(d.ocorrencias)} ocorrências).`,
      acao: `Priorize esta consulta: reduzir o tempo médio dela pela metade economizaria cerca de ${formatarDuracao(d.tempo_total_ms / 2)} no período analisado.`,
    });
  }

  const porMinuto = d.duracao_periodo_s && d.duracao_periodo_s >= 600 ? d.ocorrencias / (d.duracao_periodo_s / 60) : null;
  if ((d.ocorrencias >= 1000 || (porMinuto !== null && porMinuto >= 10)) && variacao < 3) {
    r.push({
      id: "frequencia",
      severidade: "media",
      titulo: "Execuções muito frequentes",
      evidencia: `Foram ${formatarNumero(d.ocorrencias)} execuções lentas${porMinuto ? ` (cerca de ${formatarNumero(Math.round(porMinuto))} por minuto)` : ""}, com duração estável em torno de ${formatarDuracao(centro)}. O custo vem mais da repetição do que de cada execução.`,
      acao:
        "Verifique se a aplicação executa a mesma consulta dentro de um laço (padrão N+1) e junte as chamadas em uma única consulta (com IN, ANY ou JOIN). " +
        "Resultados que mudam pouco podem ficar em cache na aplicação.",
    });
  }

  if (d.ocorrencias >= 10 && (variacao >= 3 || (d.ocorrencias >= 20 && d.max_ms >= 10 * centro))) {
    const bloqueio = /\bFOR\s+(UPDATE|SHARE|NO\s+KEY)\b/i.test(d.texto) || /^(UPDATE|DELETE|INSERT)$/.test(e.tipo);
    r.push({
      id: "variabilidade",
      severidade: "media",
      titulo: "Duração muito variável",
      evidencia: `Metade das execuções leva até ${formatarDuracao(centro)}, mas 5% passam de ${formatarDuracao(d.p95_ms)} e a mais lenta levou ${formatarDuracao(d.max_ms)}.`,
      acao:
        (bloqueio
          ? "Como a instrução bloqueia linhas, a causa mais provável é a espera por bloqueios de outras transações: mantenha as transações curtas e ative log_lock_waits = on para registrar as esperas. "
          : "Duração instável costuma indicar fatores externos: espera por bloqueios (ative log_lock_waits = on), outras cargas no mesmo horário ou dados que nem sempre estão em cache. ") +
        "Também pode haver planos diferentes conforme o valor dos parâmetros: compare o EXPLAIN de uma ocorrência rápida e o de uma lenta, usando o texto executado da lista de ocorrências.",
    });
  }

  if (d.tendencia && d.tendencia >= 1.5 && d.ocorrencias >= 30) {
    r.push({
      id: "tendencia",
      severidade: "media",
      titulo: "Duração crescente ao longo do tempo",
      evidencia: `A duração média das ocorrências mais recentes é ${vezes(d.tendencia)} a das mais antigas do período.`,
      acao:
        "Consultas que pioram com o tempo acompanham o crescimento da tabela sem um índice adequado, estatísticas desatualizadas ou inchaço (bloat) por autovacuum insuficiente. " +
        "Execute ANALYZE na tabela, verifique o número de linhas mortas e, em tabelas grandes, reduza autovacuum_vacuum_scale_factor.",
      sql: `SELECT relname, n_live_tup, n_dead_tup, last_autovacuum, last_autoanalyze\nFROM pg_stat_user_tables${tabela ? `\nWHERE relname = '${tabela.split(".").pop()}'` : ""};`,
    });
  }

  const p = d.pgss;
  if (p && p.calls > 0) {
    const blocos = p.shared_blks_hit + p.shared_blks_read;
    const linhas = p.rows / p.calls;
    const blocosPorExec = blocos / p.calls;
    if (blocosPorExec >= 10000 && blocosPorExec / Math.max(linhas, 1) >= 100) {
      r.push({
        id: "leitura-excessiva",
        severidade: "alta",
        titulo: "Lê muito mais dados do que devolve",
        evidencia: `Cada execução acessa em média ${formatarNumero(Math.round(blocosPorExec))} blocos (cerca de ${formatarNumero(Math.round((blocosPorExec * 8) / 1024))} MB) para devolver ${formatarNumero(Math.round(linhas))} linha${Math.round(linhas) === 1 ? "" : "s"}.`,
        acao: "Essa desproporção é típica de leitura sequencial da tabela. Confirme no EXPLAIN (procure Seq Scan com muitas linhas removidas pelo filtro). Se a consulta filtra os dados, um índice nas colunas do filtro reduz as páginas lidas; se ela precisa percorrer a tabela, como em relatórios e agregações, guarde o resultado pronto (visão materializada ou tabela de resumo).",
      });
    }
    if (blocos >= 1000 && p.shared_blks_hit / blocos < 0.9) {
      const acerto = p.shared_blks_hit / blocos;
      r.push({
        id: "cache",
        severidade: acerto < 0.7 ? "alta" : "media",
        titulo: "Muitos dados lidos do disco",
        evidencia: `${pct(1 - acerto)} dos blocos acessados não estavam em memória (${formatarNumero(p.shared_blks_read)} blocos lidos do disco).`,
        acao: "Reduza as páginas lidas com um índice mais seletivo. Se os dados acessados com frequência não cabem na memória, avalie aumentar shared_buffers (em geral, cerca de 25% da RAM) ou a memória do servidor.",
      });
    }
    if (linhas >= 10000) {
      const dml = /^(UPDATE|DELETE|INSERT)$/.test(e.tipo);
      r.push({
        id: "muitas-linhas",
        severidade: "media",
        titulo: dml ? "Alteração de muitas linhas por execução" : "Muitas linhas por execução",
        evidencia: `Em média, cada execução ${dml ? "altera" : "devolve"} ${formatarNumero(Math.round(linhas))} linhas.`,
        acao: dml
          ? "Processe em lotes menores, para reduzir a duração dos bloqueios e o volume de WAL de cada transação."
          : "Pagine o resultado, faça as agregações no banco em vez de na aplicação e selecione apenas as linhas necessárias.",
      });
    }
    if (p.calls >= 5 * d.ocorrencias && p.mean_exec_time > 0 && p.mean_exec_time * 3 <= d.media_ms) {
      r.push({
        id: "parte-lenta",
        severidade: "baixa",
        titulo: "Apenas parte das execuções é lenta",
        evidencia: `O pg_stat_statements registra ${formatarNumero(p.calls)} execuções com média de ${formatarDuracao(p.mean_exec_time)}, enquanto as registradas no log têm média de ${formatarDuracao(d.media_ms)}.`,
        acao: "A consulta costuma ser rápida e só alguns valores de parâmetro, ou alguns momentos, a tornam lenta. Compare os valores das ocorrências lentas: dados muito desbalanceados podem pedir um índice parcial ou estatísticas estendidas (CREATE STATISTICS).",
      });
    }
  }
  return r;
}

/** Comando para analisar o plano de execução com os valores de uma ocorrência real. */
function recomendacaoPlano(d: DadosDiagnostico): Recomendacao {
  const tipo = analisarEstrutura(d.texto).tipo;
  const texto = (d.exemplo ?? d.texto).trim().replace(/;\s*$/, "");
  const altera = /^(UPDATE|DELETE|INSERT|MERGE)$/.test(tipo);
  const temParametro = !d.exemplo && /\$\d+/.test(d.texto);
  return {
    id: "plano",
    severidade: "verificacao",
    titulo: "Confirme no plano de execução",
    evidencia: d.exemplo ? "Comando montado com o texto executado na ocorrência mais lenta, com os valores reais dos parâmetros." : "O log não trouxe os valores desta consulta.",
    acao:
      "Execute o comando em uma sessão do banco, de preferência fora do horário de pico, pois ANALYZE executa a consulta de verdade" +
      (altera ? " (por isso ele está dentro de uma transação desfeita no final)" : "") +
      ". Procure Seq Scan em tabelas grandes, estimativas de linhas muito diferentes das reais e etapas com muitos blocos lidos." +
      (temParametro ? " Substitua os parâmetros $1, $2... por valores reais antes de executar." : ""),
    sql: altera ? `BEGIN;\nEXPLAIN (ANALYZE, BUFFERS) ${texto};\nROLLBACK;` : `EXPLAIN (ANALYZE, BUFFERS) ${texto};`,
  };
}

export function diagnosticar(d: DadosDiagnostico): Recomendacao[] {
  const r = [...regrasDasEstatisticas(d), ...regrasDoTexto(d)];
  r.sort((a, b) => ORDEM[a.severidade] - ORDEM[b.severidade]);
  if (!r.some((x) => x.id === "manutencao" || x.id === "commit")) r.push(recomendacaoPlano(d));
  return r;
}

/** Recomendação mais relevante sobre a própria consulta (desconsidera a de impacto e a do plano). */
export function principal(r: Recomendacao[]): Recomendacao | null {
  return r.find((x) => x.id !== "impacto" && x.id !== "plano") ?? null;
}

/** Razão entre a duração média do último e a do primeiro terço de uma série ordenada no tempo. */
export function calcularTendencia(duracoes: number[]): number | null {
  if (duracoes.length < 30) return null;
  const t = Math.floor(duracoes.length / 3);
  const media = (v: number[]) => v.reduce((s, x) => s + x, 0) / v.length;
  const inicio = media(duracoes.slice(0, t));
  return inicio > 0 ? media(duracoes.slice(-t)) / inicio : null;
}
