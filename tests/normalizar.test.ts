import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizarSql } from "../src/lib/normalizar";

test("substitui literais por parâmetros numerados", () => {
  const r = normalizarSql("SELECT * FROM pedido WHERE cliente_id = 42 AND status = 'pago' AND valor > 10.5");
  assert.equal(r.texto, "SELECT * FROM pedido WHERE cliente_id = $1 AND status = $2 AND valor > $3");
});

test("valores diferentes geram a mesma identidade", () => {
  const a = normalizarSql("select * from pedido where cliente_id = 1");
  const b = normalizarSql("SELECT *\n  FROM pedido\n WHERE cliente_id=9999;");
  const c = normalizarSql("SELECT * FROM pedido WHERE cliente_id = $1");
  assert.equal(a.fingerprint, b.fingerprint);
  assert.equal(a.fingerprint, c.fingerprint);
});

test("consultas diferentes geram identidades diferentes", () => {
  const a = normalizarSql("SELECT * FROM pedido WHERE cliente_id = 1");
  const b = normalizarSql("SELECT * FROM pedido WHERE id = 1");
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("agrupa listas IN de tamanhos diferentes", () => {
  const a = normalizarSql("SELECT 1 FROM t WHERE id IN (1, 2, 3)");
  const b = normalizarSql("SELECT 1 FROM t WHERE id IN (7,8,9,10,11)");
  assert.equal(a.texto, "SELECT $1 FROM t WHERE id IN ($2 /*, ... */)");
  assert.equal(a.fingerprint, b.fingerprint);
});

test("agrupa linhas de VALUES", () => {
  const a = normalizarSql("INSERT INTO t (a, b) VALUES (1, 'x'), (2, 'y'), (3, 'z')");
  const b = normalizarSql("INSERT INTO t (a, b) VALUES (1, 'x')");
  assert.equal(a.texto, "INSERT INTO t (a, b) VALUES ($1, $2) /*, ... */");
  assert.notEqual(a.fingerprint, b.fingerprint);
});

test("mantém identificadores com números e entre aspas", () => {
  const r = normalizarSql('SELECT col1, "Tabela 2".x FROM t2 WHERE "Tabela 2".y = 3');
  assert.equal(r.texto, 'SELECT col1, "Tabela 2".x FROM t2 WHERE "Tabela 2".y = $1');
});

test("trata aspas escapadas, prefixo E e textos delimitados por cifrão", () => {
  assert.equal(normalizarSql("SELECT 'it''s'").texto, "SELECT $1");
  assert.equal(normalizarSql("SELECT E'a\\'b' || 'c'").texto, "SELECT $1 || $2");
  assert.equal(normalizarSql("SELECT $$texto; com ' aspas$$, $tag$x$tag$").texto, "SELECT $1, $2");
});

test("remove comentários", () => {
  const r = normalizarSql("/* app=loja */ SELECT a -- comentário\nFROM t");
  assert.equal(r.texto, "SELECT a FROM t");
});

test("não confunde intervalos e casts", () => {
  const r = normalizarSql("SELECT now() - interval '30 days', x::numeric(10,2) FROM t");
  assert.equal(r.texto, "SELECT now() - interval $1, x::numeric($2,$3) FROM t");
});
