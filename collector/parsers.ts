import type { RegistroLog, TrechoInterpretado } from "./tipos";

const vazioParaNull = (v: string | undefined | null): string | null =>
  v === undefined || v === null || v === "" ? null : v;

const inteiroOuNull = (v: string | number | undefined | null): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** query_id 0 indica que o identificador não foi calculado (compute_query_id desativado). */
const queryIdOuNull = (v: string | number | undefined | null): string | null => {
  if (v === undefined || v === null || v === "" || v === 0 || v === "0") return null;
  return String(v);
};

/** Remove a porta de "host:porta" (formato da coluna connection_from do csvlog). */
function hostSemPorta(v: string | null): string | null {
  if (!v) return null;
  if (v.startsWith("[")) return v; // [local]
  const m = v.match(/^(.*):(\d+)$/);
  return m ? m[1] : v;
}

/**
 * Interpreta um trecho de arquivo no formato csvlog. Campos entre aspas podem conter
 * quebras de linha, por isso apenas os registros completos são considerados; o restante
 * é lido novamente no próximo ciclo.
 */
export function interpretarCsvlog(texto: string): TrechoInterpretado {
  const registros: RegistroLog[] = [];
  let campos: string[] = [];
  let campo = "";
  let entreAspas = false;
  let fimUltimoRegistro = 0;

  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (entreAspas) {
      if (c === '"') {
        if (texto[i + 1] === '"') { campo += '"'; i++; }
        else entreAspas = false;
      } else campo += c;
      continue;
    }
    if (c === '"') { entreAspas = true; continue; }
    if (c === ",") { campos.push(campo); campo = ""; continue; }
    if (c === "\r") continue;
    if (c === "\n") {
      campos.push(campo);
      if (campos.length >= 23) registros.push(registroDoCsv(campos));
      campos = [];
      campo = "";
      fimUltimoRegistro = i + 1;
      continue;
    }
    campo += c;
  }

  return {
    registros,
    bytesConsumidos: Buffer.byteLength(texto.slice(0, fimUltimoRegistro), "utf8"),
  };
}

// Colunas do csvlog: https://www.postgresql.org/docs/18/runtime-config-logging.html#RUNTIME-CONFIG-LOGGING-CSVLOG
function registroDoCsv(c: string[]): RegistroLog {
  return {
    dataHora: c[0],
    usuario: vazioParaNull(c[1]),
    banco: vazioParaNull(c[2]),
    pid: inteiroOuNull(c[3]),
    hostCliente: hostSemPorta(vazioParaNull(c[4])),
    severidade: vazioParaNull(c[11]),
    mensagem: c[13] ?? "",
    detalhe: vazioParaNull(c[14]),
    aplicacao: vazioParaNull(c[22]),
    tipoProcesso: vazioParaNull(c[23]),
    queryId: queryIdOuNull(c[25]),
  };
}

/** Interpreta um trecho de arquivo no formato jsonlog (um objeto JSON por linha). */
export function interpretarJsonlog(texto: string): TrechoInterpretado {
  const registros: RegistroLog[] = [];
  let inicio = 0;
  let fimUltimoRegistro = 0;
  for (;;) {
    const fim = texto.indexOf("\n", inicio);
    if (fim < 0) break;
    const linha = texto.slice(inicio, fim).trim();
    inicio = fim + 1;
    fimUltimoRegistro = inicio;
    if (!linha) continue;
    try {
      const o = JSON.parse(linha) as Record<string, string | number | undefined>;
      registros.push({
        dataHora: String(o.timestamp),
        usuario: vazioParaNull(o.user as string),
        banco: vazioParaNull(o.dbname as string),
        pid: inteiroOuNull(o.pid),
        hostCliente: vazioParaNull(o.remote_host as string),
        severidade: vazioParaNull(o.error_severity as string),
        mensagem: String(o.message ?? ""),
        detalhe: vazioParaNull(o.detail as string),
        aplicacao: vazioParaNull(o.application_name as string),
        tipoProcesso: vazioParaNull(o.backend_type as string),
        queryId: queryIdOuNull(o.query_id),
      });
    } catch {
      // linha inválida: ignorada
    }
  }
  return {
    registros,
    bytesConsumidos: Buffer.byteLength(texto.slice(0, fimUltimoRegistro), "utf8"),
  };
}
