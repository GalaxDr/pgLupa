import { createHash } from "node:crypto";

const PARAM = "\u0001";

function ehCaractereDeIdentificador(c: string | undefined): boolean {
  return c !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(c);
}

/**
 * Substitui os valores literais de uma instrução SQL por parâmetros ($1, $2, ...),
 * remove comentários e espaços redundantes e agrupa listas de valores, de modo que
 * execuções da mesma consulta com valores diferentes resultem no mesmo texto.
 */
export function normalizarSql(sql: string): { texto: string; fingerprint: string } {
  let out = "";
  let i = 0;
  const n = sql.length;

  const emitirParametro = () => {
    // remove um prefixo de literal (E'...', B'...', X'...', N'...', U&'...')
    const m = out.match(/(?:^|[^A-Za-z0-9_$])([EeBbXxNn]|[Uu]&)$/);
    if (m) out = out.slice(0, out.length - m[1].length);
    out += PARAM;
  };

  while (i < n) {
    const c = sql[i];
    const d = sql[i + 1];

    // comentário de linha
    if (c === "-" && d === "-") {
      while (i < n && sql[i] !== "\n") i++;
      out += " ";
      continue;
    }
    // comentário de bloco (pode ser aninhado no PostgreSQL)
    if (c === "/" && d === "*") {
      let nivel = 1;
      i += 2;
      while (i < n && nivel > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") { nivel++; i += 2; }
        else if (sql[i] === "*" && sql[i + 1] === "/") { nivel--; i += 2; }
        else i++;
      }
      out += " ";
      continue;
    }
    // literal de texto
    if (c === "'") {
      const escapeComBarra = /(?:^|[^A-Za-z0-9_$])[Ee]$/.test(out);
      i++;
      while (i < n) {
        if (escapeComBarra && sql[i] === "\\") { i += 2; continue; }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") { i += 2; continue; }
          i++;
          break;
        }
        i++;
      }
      emitirParametro();
      continue;
    }
    // identificador entre aspas: mantido como está
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') { j += 2; continue; }
          j++;
          break;
        }
        j++;
      }
      out += sql.slice(i, j);
      i = j;
      continue;
    }
    if (c === "$") {
      // parâmetro já existente ($1, $2, ...)
      const p = sql.slice(i).match(/^\$(\d+)/);
      if (p && !ehCaractereDeIdentificador(out[out.length - 1])) {
        out += PARAM;
        i += p[0].length;
        continue;
      }
      // texto delimitado por cifrão ($$...$$ ou $tag$...$tag$)
      const t = sql.slice(i).match(/^\$([A-Za-z_][A-Za-z0-9_]*)?\$/);
      if (t && !ehCaractereDeIdentificador(out[out.length - 1])) {
        const fim = sql.indexOf(t[0], i + t[0].length);
        i = fim < 0 ? n : fim + t[0].length;
        out += PARAM;
        continue;
      }
    }
    // literal numérico
    if (/[0-9]/.test(c) || (c === "." && d !== undefined && /[0-9]/.test(d))) {
      if (!ehCaractereDeIdentificador(out[out.length - 1])) {
        const m = sql.slice(i).match(/^(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|(?:\d[\d_]*(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)/);
        if (m) {
          out += PARAM;
          i += m[0].length;
          continue;
        }
      }
    }
    // espaços
    if (/\s/.test(c)) {
      if (out.length > 0 && out[out.length - 1] !== " ") out += " ";
      i++;
      continue;
    }
    out += c;
    i++;
  }

  let texto = out.replace(/ +/g, " ").trim().replace(/\s*;\s*$/, "");

  // listas de valores: IN (1, 2, 3), ARRAY[1, 2, 3] e VALUES (..), (..)
  const p = PARAM;
  texto = texto
    .replace(new RegExp(`(\\bin\\s*\\()\\s*${p}(?:\\s*,\\s*${p})+\\s*\\)`, "gi"), `$1${p} /*, ... */)`)
    .replace(new RegExp(`(\\barray\\s*\\[)\\s*${p}(?:\\s*,\\s*${p})+\\s*\\]`, "gi"), `$1${p} /*, ... */]`)
    .replace(
      new RegExp(`(\\(\\s*${p}(?:\\s*,\\s*${p})*\\s*\\))(?:\\s*,\\s*\\(\\s*${p}(?:\\s*,\\s*${p})*\\s*\\))+`, "g"),
      "$1 /*, ... */",
    );

  // identidade da consulta: ignora caixa, numeração dos parâmetros e espaços junto à pontuação
  const base = texto
    .toLowerCase()
    .replace(new RegExp(p, "g"), "?")
    .replace(/\s*([^\w\s$?"])\s*/g, "$1");
  const fingerprint = createHash("md5").update(base).digest("hex");

  let k = 0;
  texto = texto.replace(new RegExp(p, "g"), () => `$${++k}`);
  return { texto, fingerprint };
}
