import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizarSql } from "../src/lib/normalizar";
import { calcularTendencia, diagnosticar, principal, type DadosDiagnostico } from "../src/lib/recomendacoes";

const base = { ocorrencias: 50, tempo_total_ms: 50_000, media_ms: 1000, mediana_ms: 950, p95_ms: 1400, max_ms: 1800 };

function diag(sql: string, extra: Partial<DadosDiagnostico> = {}) {
  return diagnosticar({ ...base, texto: normalizarSql(sql).texto, exemplo: sql, ...extra });
}
const ids = (sql: string, extra: Partial<DadosDiagnostico> = {}) => diag(sql, extra).map((r) => r.id);

test("sugere índice composto com igualdades antes da ordenação", () => {
  const r = diag("SELECT id FROM pedido WHERE cliente_id = 42 AND status = 'pago' ORDER BY criado_em DESC LIMIT 20");
  const indice = r.find((x) => x.id === "indice");
  assert.equal(indice?.sql, "CREATE INDEX CONCURRENTLY ON pedido (cliente_id, status, criado_em);");
});

test("não sugere índice para busca apenas pela chave primária", () => {
  assert.ok(!ids("SELECT nome FROM cliente WHERE id = 7").includes("indice"));
});

test("associa as colunas às tabelas pelos aliases", () => {
  const r = diag("SELECT p.id FROM pedido p JOIN cliente c ON c.id = p.cliente_id WHERE c.cidade = 'X'");
  assert.equal(r.find((x) => x.id === "indice")?.sql, "CREATE INDEX CONCURRENTLY ON cliente (cidade);");
  assert.equal(r.find((x) => x.id === "juncao")?.sql, "CREATE INDEX CONCURRENTLY ON pedido (cliente_id);");
});

test("curinga no início do LIKE usa os valores do texto executado", () => {
  const r = diag("SELECT id FROM cliente WHERE nome LIKE '%silva%'");
  const like = r.find((x) => x.id === "like-curinga");
  assert.equal(like?.severidade, "alta");
  assert.match(like!.sql!, /ON cliente USING gin \(nome gin_trgm_ops\)/);
  assert.ok(ids("SELECT id FROM cliente WHERE nome LIKE 'sil%'").includes("like-prefixo"));
});

test("função sobre a coluna do filtro", () => {
  assert.match(diag("SELECT id FROM cliente WHERE lower(email) = 'a@b.c'").find((x) => x.id === "funcao-coluna")!.sql!, /\(\(lower\(email\)\)\)/);
  assert.match(diag("SELECT id FROM pedido WHERE date(criado_em) = '2026-01-01'").find((x) => x.id === "funcao-coluna")!.sql!, /criado_em >= \$1/);
});

test("padrões de reescrita", () => {
  assert.ok(ids("SELECT * FROM pedido ORDER BY id LIMIT 50 OFFSET 20000").includes("offset"));
  assert.ok(!ids("SELECT * FROM pedido ORDER BY id LIMIT 50 OFFSET 20").includes("offset"));
  assert.ok(ids("SELECT id FROM cliente WHERE id NOT IN (SELECT cliente_id FROM pedido)").includes("not-in"));
  assert.ok(ids("SELECT id FROM produto ORDER BY random() LIMIT 5").includes("order-random"));
  assert.ok(ids("SELECT count(*) FROM pedido").includes("count-total"));
  assert.ok(ids("SELECT status, sum(valor) FROM pedido GROUP BY status").includes("agregacao-total"));
  assert.ok(ids("SELECT c.nome, (SELECT count(*) FROM pedido p WHERE p.cliente_id = c.id) FROM cliente c").includes("subconsulta-select"));
  assert.ok(ids("DELETE FROM pedido").includes("dml-sem-where"));
  const lista = `SELECT id FROM produto WHERE id IN (${Array.from({ length: 150 }, (_, i) => i).join(", ")})`;
  assert.ok(ids(lista).includes("in-grande"));
});

test("CTEs não são tratadas como tabelas", () => {
  assert.deepEqual(ids("WITH t AS (SELECT * FROM pedido WHERE valor > 10) SELECT cliente_id, count(*) FROM t GROUP BY cliente_id"), ["plano"]);
});

test("manutenção e COMMIT não recebem EXPLAIN", () => {
  assert.deepEqual(ids("VACUUM ANALYZE pedido"), ["manutencao"]);
  assert.deepEqual(ids("COMMIT"), ["commit"]);
});

test("EXPLAIN de instruções que alteram dados fica dentro de uma transação desfeita", () => {
  const plano = diag("UPDATE estoque SET qtd = qtd - 1 WHERE produto_id = 5").find((x) => x.id === "plano")!;
  assert.equal(plano.sql, "BEGIN;\nEXPLAIN (ANALYZE, BUFFERS) UPDATE estoque SET qtd = qtd - 1 WHERE produto_id = 5;\nROLLBACK;");
});

test("regras das estatísticas", () => {
  const sql = "SELECT nome FROM cliente WHERE id = 7";
  assert.ok(ids(sql, { participacao: 0.4 }).includes("impacto"));
  assert.ok(ids(sql, { ocorrencias: 5000, duracao_periodo_s: 3600 }).includes("frequencia"));
  assert.ok(ids(sql, { mediana_ms: 200, p95_ms: 3000 }).includes("variabilidade"));
  assert.ok(ids(sql, { tendencia: 2 }).includes("tendencia"));
  const pgss = { calls: 100, mean_exec_time: 900, rows: 100, shared_blks_hit: 1_000_000, shared_blks_read: 2_000_000 };
  const r = ids(sql, { pgss });
  assert.ok(r.includes("leitura-excessiva") && r.includes("cache"));
  assert.ok(ids(sql, { pgss: { ...pgss, calls: 10_000, mean_exec_time: 5 } }).includes("parte-lenta"));
});

test("ordena por severidade e deixa o plano por último", () => {
  const r = diag("SELECT * FROM cliente WHERE nome ILIKE '%a%' OFFSET 50000", { participacao: 0.5 });
  assert.equal(r[r.length - 1].id, "plano");
  const ordem = { alta: 0, media: 1, baixa: 2 };
  for (let i = 1; i < r.length - 1; i++) assert.ok(ordem[r[i - 1].severidade] <= ordem[r[i].severidade]);
  assert.notEqual(principal(r)?.id, "impacto");
});

test("tendência compara o último e o primeiro terço", () => {
  assert.equal(calcularTendencia([1, 2, 3]), null);
  const v = [...Array(10).fill(100), ...Array(10).fill(150), ...Array(10).fill(200)];
  assert.equal(calcularTendencia(v), 2);
});
