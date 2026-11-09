import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizarSql } from "../src/lib/normalizar";
import { diagnosticar } from "../src/lib/recomendacoes";

const base = { ocorrencias: 5, tempo_total_ms: 5000, media_ms: 1000, p95_ms: 1200, max_ms: 1300 };

test("com os valores anonimizados, o EXPLAIN pede a substituição dos parâmetros", () => {
  const texto = normalizarSql("SELECT id FROM cliente WHERE email = 'maria@exemplo.com'").texto;
  const plano = diagnosticar({ ...base, texto, exemplo: texto }).find((r) => r.id === "plano")!;
  assert.match(plano.acao, /Substitua os parâmetros/);
  assert.doesNotMatch(plano.sql!, /maria/);
});
