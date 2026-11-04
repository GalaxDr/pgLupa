import assert from "node:assert/strict";
import { test } from "node:test";
import { aplicarParametros, interpretarMensagem } from "../collector/mensagem";
import { interpretarCsvlog, interpretarJsonlog } from "../collector/parsers";

const linhaCsv = (msg: string, detalhe = "", queryId = "-123456789") =>
  `2026-11-04 18:30:00.123 UTC,"app","loja",4242,"172.18.0.1:51234",6729a1b8.1092,7,"SELECT",2026-11-04 18:29:00 UTC,3/12,0,LOG,00000,"${msg.replace(/"/g, '""')}","${detalhe.replace(/"/g, '""')}",,,,,,,,"psql","client backend",,${queryId}\n`;

test("csvlog: interpreta registros completos e preserva o restante", () => {
  const completo = linhaCsv("duration: 1523.402 ms  statement: SELECT \"x\",\n 1");
  const parcial = linhaCsv("duration: 10 ms  statement: SELECT 2").slice(0, 50);
  const r = interpretarCsvlog(completo + parcial);
  assert.equal(r.registros.length, 1);
  assert.equal(r.bytesConsumidos, Buffer.byteLength(completo));
  const reg = r.registros[0];
  assert.equal(reg.usuario, "app");
  assert.equal(reg.banco, "loja");
  assert.equal(reg.pid, 4242);
  assert.equal(reg.hostCliente, "172.18.0.1");
  assert.equal(reg.aplicacao, "psql");
  assert.equal(reg.queryId, "-123456789");
  assert.equal(reg.mensagem, 'duration: 1523.402 ms  statement: SELECT "x",\n 1');
});

test("csvlog: bytes consumidos consideram caracteres acentuados", () => {
  const l = linhaCsv("duration: 200 ms  statement: SELECT 'Venâncio Aires'");
  const r = interpretarCsvlog(l);
  assert.equal(r.bytesConsumidos, Buffer.byteLength(l));
});

test("csvlog: query_id 0 é tratado como ausente", () => {
  const r = interpretarCsvlog(linhaCsv("duration: 1 ms  statement: SELECT 1", "", "0"));
  assert.equal(r.registros[0].queryId, null);
});

test("jsonlog: interpreta linhas completas", () => {
  const l = JSON.stringify({ timestamp: "2026-11-04 18:30:00.123 UTC", user: "app", dbname: "loja", pid: 7, remote_host: "10.0.0.2", error_severity: "LOG", message: "duration: 300.5 ms  statement: SELECT 1", application_name: "api", query_id: 99 });
  const r = interpretarJsonlog(l + "\n" + '{"timestamp":"incompleto');
  assert.equal(r.registros.length, 1);
  assert.equal(r.registros[0].queryId, "99");
  assert.equal(r.bytesConsumidos, Buffer.byteLength(l) + 1);
});

test("mensagem: considera statement e execute e ignora parse e bind", () => {
  assert.deepEqual(interpretarMensagem("duration: 1523.402 ms  statement: SELECT 1"), { duracaoMs: 1523.402, etapa: "statement", sql: "SELECT 1" });
  assert.deepEqual(interpretarMensagem("duration: 12.5 ms  execute <unnamed>: SELECT $1"), { duracaoMs: 12.5, etapa: "execute", sql: "SELECT $1" });
  assert.equal(interpretarMensagem("duration: 12.5 ms  parse <unnamed>: SELECT $1"), null);
  assert.equal(interpretarMensagem("duration: 12.5 ms  bind S_1: SELECT $1"), null);
  assert.equal(interpretarMensagem("duration: 0.5 ms"), null);
  assert.equal(interpretarMensagem("connection received: host=[local]"), null);
});

test("mensagem: reconstrói o texto executado com os parâmetros", () => {
  const sql = "SELECT * FROM t WHERE a = $1 AND b = $2 AND c = $10";
  const det = "Parameters: $1 = '42', $2 = 'O''Brien', $10 = NULL";
  assert.equal(aplicarParametros(sql, det), "SELECT * FROM t WHERE a = '42' AND b = 'O''Brien' AND c = NULL");
});
